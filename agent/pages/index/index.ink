<script def>
{
  "navigationBarTitleText": "潮汐方舟"
}
</script>

<script setup>
import wx from 'wx';
import { LanguageModel } from 'language-model';
import * as G from '../../core/game.js';

const KEY_MAP = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'enter', Backspace: 'back' };
const LLM_POLL_MS = 60;
const LLM_TIMEOUT_MS = 12000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TICK_MS = 1000;
const SALVAGE_MS = 50;
const SAVE_EVERY = 5;

export default {
  data: {
    vm: G.view(G.newGame()),
  },

  onLoad() {
    this.state = G.restore(this.loadSave());
    this.handled = {};
    this.saveCountdown = SAVE_EVERY;
    this.render();
  },

  onShow() {
    this.startLoops();
  },

  onHide() {
    this.stopLoops();
    this.save();
  },

  onUnload() {
    this.stopLoops();
    this.save();
  },

  // ---------- persistence ----------
  loadSave() {
    try {
      return wx.getStorageSync(G.SAVE_KEY);
    } catch (err) {
      console.warn('[tideark] load failed', err);
      return undefined;
    }
  },

  save() {
    if (!this.state) return;
    try {
      wx.setStorageSync(G.SAVE_KEY, G.serialize(this.state));
    } catch (err) {
      console.warn('[tideark] save failed', err);
    }
  },

  // ---------- loops ----------
  startLoops() {
    this.stopLoops();
    this.lastTick = Date.now();
    this.tickTimer = setInterval(() => this.onTick(), TICK_MS);
    this.syncSalvageLoop();
  },

  stopLoops() {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    this.stopSalvageLoop();
  },

  onTick() {
    const now = Date.now();
    const dt = Math.min(2, (now - this.lastTick) / 1000);
    this.lastTick = now;
    G.tick(this.state, dt);
    if (--this.saveCountdown <= 0) { this.saveCountdown = SAVE_EVERY; this.save(); }
    this.render();
  },

  syncSalvageLoop() {
    const sv = this.state && this.state.ui.salvage;
    const active = !!(sv && !sv.done && !G.isPaused(this.state));
    if (active && !this.salvageTimer && this.tickTimer) {
      this.lastStep = Date.now();
      this.salvageTimer = setInterval(() => this.onSalvageStep(), SALVAGE_MS);
    } else if (!active) {
      this.stopSalvageLoop();
    }
  },

  stopSalvageLoop() {
    if (this.salvageTimer) { clearInterval(this.salvageTimer); this.salvageTimer = null; }
  },

  onSalvageStep() {
    const now = Date.now();
    const dt = Math.min(0.2, (now - this.lastStep) / 1000);
    this.lastStep = now;
    G.salvageStep(this.state, dt);
    const sv = this.state.ui.salvage;
    if (sv) this.setData({ 'vm.salvage.cursor': Math.round(sv.cursor * 10) / 10 });
    else this.stopSalvageLoop();
  },

  render() {
    this.setData({ vm: G.view(this.state) });
    this.syncSalvageLoop();
    this.voice();
  },

  // ---------- 居民说话（可选：LanguageModel 改写台词 + TTS 播报） ----------
  // 台词先显示写好的版本；大模型可用时流式替换成一句新的，再用居民音色读出来。
  // 任何一步不可用（预览、没网、配额用完）都静默退回固定台词。
  voice() {
    const o = this.state && this.state.ui.overlay;
    if (!o || (o.kind !== 'crew' && o.kind !== 'talk') || o.voiced) return;
    o.voiced = true;
    const p = G.talkPrompt(this.state, o);
    this.rewrite(o, p).then((text) => this.speak(text, p.voice));
  },

  // LanguageModelTextStream 是轮询包装：read() 返回 { done, value }，value 为 undefined 表示暂时没有新块。
  // 不是异步迭代器，不能 for await。
  async rewrite(o, p) {
    let text = G.clipLine(p.fallback);
    try {
      if (!LanguageModel || (await LanguageModel.availability()) !== 'available') {
        console.log('[tideark] llm not available, using fallback line');
        return text;
      }
      const session = await LanguageModel.create({ initialPrompts: [{ role: 'system', content: p.system }] });
      let out = '';
      const started = Date.now();
      try {
        const stream = session.promptStreaming(p.user);
        while (true) {
          if (this.state.ui.overlay !== o || Date.now() - started > LLM_TIMEOUT_MS) {
            stream.cancel();
            break;
          }
          const { done, value } = await stream.read();
          if (done) break;
          if (value === undefined) { await sleep(LLM_POLL_MS); continue; }
          // 有的实现给增量，有的给累计全文
          out = value.startsWith(out) ? value : out + value;
          o.lines[o.say] = `「${G.clipLine(out)}」`;
          this.setData({ vm: G.view(this.state) });
        }
      } finally {
        session.destroy();
      }
      console.log(`[tideark] llm line in ${Date.now() - started}ms: ${out}`);
      if (G.clipLine(out)) text = G.clipLine(out);
      else o.lines[o.say] = `「${text}」`;
    } catch (err) {
      console.warn('[tideark] llm unavailable', err);
      o.lines[o.say] = `「${text}」`;
    }
    return text;
  },

  speak(text, voiceId) {
    try {
      if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) return;
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voiceId; // AIUI：音色 ID 字符串；桌面浏览器会抛错，正好跳过
      speechSynthesis.speak(u, 'immediate');
    } catch (err) {
      console.warn('[tideark] tts unavailable', err);
    }
  },

  // ---------- input ----------
  act(code) {
    const key = KEY_MAP[code];
    if (!key || !this.state) return false;
    const handled = G.press(this.state, key);
    if (handled) {
      this.save();
      this.render();
    }
    return handled;
  },

  onKeyDown(event) {
    const code = event && event.code;
    if (!KEY_MAP[code]) return;
    this.handled[code] = { down: true, ok: this.act(code) };
  },

  onKeyUp(event) {
    const code = event && event.code;
    if (!KEY_MAP[code]) return;
    let rec = this.handled[code];
    // 某些宿主只上报 keyup：没有对应 keydown 时在此处理
    if (!rec || !rec.down) rec = { ok: this.act(code) };
    this.handled[code] = null;
    if (rec.ok && typeof event.preventDefault === 'function') event.preventDefault();
  },
};
</script>

<page>
  <view class="root">
    <!-- 顶栏：天数 / 时间 / 耐久 -->
    <view class="topbar">
      <text class="day">第 {{vm.day}} 天</text>
      <view class="daytrack"><view class="dayfill" style="width: {{vm.dayPct}}%;"></view></view>
      <text class="clock">{{vm.timeLeft}}s</text>
      <text class="hp {{vm.hpLow ? 'hp-low' : ''}}">{{vm.hpLow ? '▲ ' : ''}}耐久 {{vm.hp}}</text>
    </view>

    <!-- 资源 -->
    <view class="resrow">
      <view class="res" ink:for="{{vm.res}}" ink:key="key">
        <text class="res-sym">{{item.sym}}</text>
        <text class="res-val">{{item.val}}</text>
        <text class="res-cap">{{item.cap}}</text>
      </view>
    </view>

    <view class="divider"></view>

    <!-- 主界面 -->
    <view class="body" ink:if="{{vm.screen === 'home'}}">
      <view class="shelter">
        <text class="label">{{vm.title}}</text>
        <image class="shelter-art" ink:if="{{vm.shelterArt}}" src="{{vm.shelterArt}}" mode="aspectFit" />
        <view class="stack" ink:else>
          <view class="deck" ink:for="{{vm.decks}}" ink:key="i" style="width: {{item.w}}%;"></view>
        </view>
        <text class="waves">≈≈≈≈≈≈≈≈≈≈≈≈</text>
        <text class="storm {{vm.stormDanger ? 'storm-danger' : ''}}">{{vm.stormDanger ? '▲ ' : '○ '}}{{vm.stormText}}</text>
        <text class="caption">{{vm.prodText}}</text>
        <text class="caption">{{vm.powerText}}</text>
        <text class="caption" ink:if="{{vm.residents}}">居民 {{vm.residents}}</text>
      </view>
      <view class="menu {{vm.tight ? 'menu-tight' : ''}}">
        <view class="goal" ink:if="{{vm.goal}}">
          <view class="goal-head">
            <text class="goal-ch">{{vm.goal.chapter}}</text>
            <text class="goal-dots">{{vm.goal.dots}}</text>
          </view>
          <text class="goal-text">目标 · {{vm.goal.text}}</text>
        </view>
        <view class="row {{item.focused ? 'row-focus' : ''}} {{item.off ? 'row-off' : ''}}" ink:for="{{vm.menu}}" ink:key="i">
          <text class="row-mark">{{item.focused ? '›' : ' '}}</text>
          <image class="row-art {{item.off ? 'art-dim' : ''}}" ink:if="{{item.art}}" src="{{item.art}}" mode="aspectFit" />
          <text class="row-label">{{item.label}}</text>
          <text class="row-sub">{{item.sub}}</text>
        </view>
      </view>
    </view>

    <!-- 列表界面：建造与升级 / 选择海域 / 商人（超过 4 行时滚动） -->
    <view class="body body-col" ink:elif="{{vm.list}}">
      <view class="list-head">
        <text class="label">{{vm.title}}</text>
        <text class="more">{{vm.moreUp ? '▲' : ''}}{{vm.moreDown ? ' ▼' : ''}}</text>
      </view>
      <view class="brow {{item.focused ? 'brow-focus' : ''}} {{item.off ? 'brow-off' : ''}}" ink:for="{{vm.menu}}" ink:key="i">
        <text class="row-mark">{{item.focused ? '›' : ' '}}</text>
        <image class="brow-art {{item.artDim ? 'art-dim' : ''}}" ink:if="{{item.art}}" src="{{item.art}}" mode="aspectFit" />
        <view class="brow-main">
          <view class="brow-head">
            <text class="row-label">{{item.label}}</text>
            <text class="chip">{{item.state}}</text>
            <text class="cost">{{item.cost}}</text>
          </view>
          <text class="caption">{{item.sub}}</text>
        </view>
      </view>
    </view>

    <!-- 宝箱 -->
    <view class="body body-col" ink:elif="{{vm.screen === 'chests'}}">
      <text class="label">{{vm.title}}</text>
      <view class="chest-open" ink:if="{{vm.chest}}">
        <image class="chest-art" ink:if="{{vm.chest.art}}" src="{{vm.chest.art}}" mode="aspectFit" />
        <text class="chest-name">{{vm.chest.art ? '' : '□ '}}{{vm.chest.label}}</text>
        <view class="locks">
          <text class="lock {{item.open ? 'lock-open' : ''}}" ink:for="{{vm.chest.locks}}" ink:key="i">{{item.open ? '○' : '●'}}</text>
        </view>
        <text class="reward" ink:if="{{vm.chest.reward}}">{{vm.chest.reward}}</text>
        <text class="caption">{{vm.chest.hint}}</text>
      </view>
      <view ink:else>
        <text class="caption" ink:if="{{vm.menu.length === 0}}">没有宝箱。出海打捞时可能捞到。</text>
        <view class="row {{item.focused ? 'row-focus' : ''}}" ink:for="{{vm.menu}}" ink:key="i">
          <text class="row-mark">{{item.focused ? '›' : ' '}}</text>
          <image class="row-art" ink:if="{{item.art}}" src="{{item.art}}" mode="aspectFit" />
          <text class="row-label">{{item.art ? '' : '□ '}}{{item.label}}</text>
          <text class="row-sub">{{item.sub}}</text>
        </view>
      </view>
    </view>

    <!-- 打捞 -->
    <view class="body body-col" ink:elif="{{vm.screen === 'salvage' && vm.salvage}}">
      <view class="sv-head">
        <text class="label">{{vm.title}}</text>
        <view class="hooks">
          <text class="hook {{item.left ? '' : 'hook-used'}}" ink:for="{{vm.salvage.hooks}}" ink:key="i">{{item.left ? '↓' : '·'}}</text>
        </view>
      </view>
      <view class="sea">
        <view class="cursor" style="left: {{vm.salvage.cursor}}%;">
          <text class="cursor-head">▼</text>
          <view class="cursor-line"></view>
        </view>
        <view class="item {{item.caught ? 'item-caught' : ''}}" ink:for="{{vm.salvage.items}}" ink:key="id" style="left: {{item.x}}%; width: {{item.w}}%;">
          <image class="item-art" ink:if="{{item.art && !item.caught}}" src="{{item.art}}" mode="aspectFit" />
          <text class="item-tag" ink:else>{{item.caught ? '·' : item.tag}}</text>
        </view>
        <text class="sea-waves">≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈ ≈</text>
      </view>
      <text class="sv-last">{{vm.salvage.last}}</text>
      <text class="caption">{{vm.salvage.done ? '确认 · 返航' : '确认 · 落钩    返回 · 提前返航'}}</text>
    </view>

    <!-- 消息栏 -->
    <view class="msgbar">
      <text class="msg">{{vm.msg}}</text>
    </view>

    <!-- 弹窗：每日结算 / 沉没 / 方舟 -->
    <view class="overlay" ink:if="{{vm.overlay}}">
      <view class="dialog {{vm.overlay.kind === 'over' ? 'dialog-alert' : ''}} {{vm.overlay.art ? 'dialog-wide' : ''}}">
        <image class="dialog-art" ink:if="{{vm.overlay.art}}" src="{{vm.overlay.art}}" mode="aspectFit" />
        <view class="dialog-text">
          <text class="dialog-title">{{vm.overlay.kind === 'over' ? '▲ ' : ''}}{{vm.overlay.title}}</text>
          <text class="dialog-line" ink:for="{{vm.overlay.lines}}" ink:key="index">{{item}}</text>
          <text class="dialog-action">{{vm.overlay.action}}</text>
        </view>
      </view>
    </view>
  </view>
</page>

<style>
.root {
  --g100: #40ff5e;
  --g72: rgba(64, 255, 94, 0.72);
  --g48: rgba(64, 255, 94, 0.48);
  --g24: rgba(64, 255, 94, 0.24);
  --g12: rgba(64, 255, 94, 0.12);
  --g06: rgba(64, 255, 94, 0.06);
  position: relative;
  width: 100%;
  height: 100vh;
  box-sizing: border-box;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  background-color: #000000;
  color: var(--g72);
  font-family: sans-serif;
  overflow: hidden;
}

.topbar { display: flex; flex-direction: row; align-items: center; gap: 8px; height: 20px; }
.day { color: var(--g100); font-size: 14px; font-weight: 500; }
.daytrack { flex: 1; height: 1px; background-color: var(--g24); }
.dayfill { height: 1px; background-color: var(--g72); }
.clock { font-family: monospace; font-size: 11px; color: var(--g48); }
.hp { font-family: monospace; font-size: 13px; color: var(--g72); }
.hp-low { color: var(--g100); }

.resrow { display: flex; flex-direction: row; justify-content: space-between; margin-top: 6px; }
.res { display: flex; flex-direction: row; align-items: center; gap: 3px; }
.res-sym { font-size: 13px; color: var(--g100); }
.res-val { font-family: monospace; font-size: 13px; font-weight: 500; color: var(--g72); }
.res-cap { font-family: monospace; font-size: 10px; color: var(--g48); }

.divider { height: 1px; background-color: var(--g24); margin-top: 6px; margin-bottom: 8px; }

.body { flex: 1; display: flex; flex-direction: row; gap: 12px; overflow: hidden; }
.body-col { flex-direction: column; gap: 6px; }

.label { font-size: 11px; font-weight: 500; color: var(--g48); }
.caption { font-size: 10px; color: var(--g48); }

.shelter { width: 150px; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.stack { width: 100%; height: 108px; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 3px; }
.deck { height: 9px; box-sizing: border-box; border: 1px solid var(--g72); border-radius: 2px; background-color: var(--g06); }
.waves { font-size: 12px; color: var(--g48); }
.storm { font-size: 11px; color: var(--g72); }
.storm-danger { color: var(--g100); }

.menu { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.row {
  display: flex; flex-direction: row; align-items: center; gap: 6px;
  min-height: 34px; padding: 0 8px; box-sizing: border-box;
  border: 1px solid transparent; border-radius: 4px;
}
.menu-tight { gap: 2px; }
.menu-tight .row { min-height: 26px; }
.menu-tight .row-art { width: 22px; height: 22px; }
.row-focus { background-color: var(--g12); border-color: var(--g72); }
.row-off .row-label { color: var(--g48); }
.row-mark { width: 10px; font-size: 14px; color: var(--g100); }
.row-label { flex: 1; font-size: 14px; color: var(--g72); }
.row-focus .row-label { color: var(--g100); }
.row-sub { font-family: monospace; font-size: 11px; color: var(--g48); }

.shelter-art { width: 150px; height: 108px; }
.row-art { width: 28px; height: 28px; }
.art-dim { opacity: 0.35; }

.goal { display: flex; flex-direction: column; gap: 2px; padding: 3px 8px; border-left: 2px solid var(--g72); }
.goal-head { display: flex; flex-direction: row; justify-content: space-between; }
.goal-ch { font-size: 10px; color: var(--g48); }
.goal-dots { font-size: 10px; color: var(--g72); letter-spacing: 2px; }
.goal-text { font-size: 12px; color: var(--g100); }

.list-head { display: flex; flex-direction: row; justify-content: space-between; align-items: center; }
.more { font-size: 10px; color: var(--g72); }
.brow { display: flex; flex-direction: row; align-items: center; gap: 6px; padding: 2px 8px; border: 1px solid var(--g24); border-radius: 4px; }
.brow-art { width: 36px; height: 36px; }
.brow-main { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.brow-off { border-style: dashed; }
.brow-focus { background-color: var(--g12); border-color: var(--g72); }
.brow-off .row-label { color: var(--g48); }
.brow-focus .row-label { color: var(--g100); }
.brow-head { display: flex; flex-direction: row; align-items: center; gap: 6px; }
.brow-sub { margin-left: 16px; }
.chip { font-size: 10px; color: var(--g72); border: 1px solid var(--g24); border-radius: 4px; padding: 0 6px; }
.cost { font-family: monospace; font-size: 12px; color: var(--g72); }

.chest-open { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
.chest-art { width: 120px; height: 96px; }
.chest-name { font-size: 22px; font-weight: 500; color: var(--g100); }
.locks { display: flex; flex-direction: row; gap: 12px; }
.lock { font-size: 20px; color: var(--g100); }
.lock-open { color: var(--g48); }
.reward { font-family: monospace; font-size: 16px; color: var(--g100); }

.sv-head { display: flex; flex-direction: row; justify-content: space-between; align-items: center; }
.hooks { display: flex; flex-direction: row; gap: 6px; }
.hook { font-size: 14px; color: var(--g100); }
.hook-used { color: var(--g24); }
.sea { position: relative; height: 120px; border-bottom: 1px solid var(--g48); }
.cursor { position: absolute; top: 0; width: 2px; height: 120px; display: flex; flex-direction: column; align-items: center; }
.cursor-head { font-size: 12px; color: var(--g100); margin-left: -5px; }
.cursor-line { width: 1px; height: 100px; background-color: var(--g72); }
.item {
  position: absolute; top: 62px; height: 40px; box-sizing: border-box;
  border: 1px solid var(--g72); border-radius: 2px; background-color: var(--g06);
  display: flex; align-items: center; justify-content: center;
}
.item-caught { border-style: dashed; border-color: var(--g24); }
.item-tag { font-size: 13px; color: var(--g100); }
.item-art { width: 100%; height: 36px; }
.sea-waves { position: absolute; left: 0; bottom: 2px; font-size: 10px; color: var(--g24); }
.sv-last { font-size: 14px; color: var(--g100); }

.msgbar { height: 22px; border-top: 1px solid var(--g24); padding-top: 4px; }
.msg { font-size: 12px; color: var(--g72); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 448px; }

.overlay {
  position: absolute; left: 0; top: 0; right: 0; bottom: 0;
  display: flex; align-items: center; justify-content: center;
  background-color: #000000;
}
.dialog {
  width: 340px; padding: 16px; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--g72); border-radius: 6px; background-color: var(--g06);
}
.dialog-alert { border-style: dashed; border-width: 2px; }
.dialog-wide { width: 440px; flex-direction: row; align-items: center; gap: 14px; }
.dialog-art { width: 140px; height: 140px; }
.dialog-text { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.dialog-title { font-size: 22px; font-weight: 500; color: var(--g100); }
.dialog-line { font-size: 14px; color: var(--g72); }
.dialog-action { margin-top: 6px; font-size: 11px; font-weight: 500; color: var(--g100); }
</style>
