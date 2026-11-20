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

export default {
  data: {
    vm: G.view(G.newGame()),
  },

  onLoad() {
    this.state = G.restore(this.loadSave());
    this.handled = {};
    this.render();
    // 只记日志，便于真机调试时确认大模型是否可用
    Promise.resolve()
      .then(() => (LanguageModel ? LanguageModel.availability() : 'missing'))
      .then((a) => console.log(`[tideark] llm availability: ${a}`))
      .catch((err) => console.warn('[tideark] llm availability failed', err));
  },

  // 回合制：没有计时器，只在按键处理后渲染和存档
  onHide() {
    this.save();
  },

  onUnload() {
    // 打捞中的收获返航时才入库：关页面前先收回来，免得白花行动力
    if (this.state) G.finishSalvage(this.state, true);
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

  render() {
    this.setData({ vm: G.view(this.state) });
    this.voice();
  },

  // ---------- 居民说话（可选：LanguageModel 改写台词 + TTS 播报） ----------
  // 台词先显示写好的版本；大模型可用时流式替换成一句新的，再用居民音色读出来。
  // 任何一步不可用（预览、没网、配额用完）都静默退回固定台词。
  voice() {
    const o = this.state && this.state.ui.overlay;
    if (!o || o.kind !== 'talk' || o.voiced) return;
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
    <!-- 顶栏：天数 / 行动力 / 耐久 -->
    <view class="topbar">
      <text class="day">第 {{vm.day}} 天</text>
      <view class="aptrack">
        <text class="ap-label">行动</text>
        <view class="pip {{item.full ? 'pip-full' : ''}}" ink:for="{{vm.apPips}}" ink:key="i"></view>
      </view>
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

    <!-- 打捞：上下选一件，确认落钩；最后一格是返航 -->
    <view class="body body-col" ink:elif="{{vm.screen === 'salvage' && vm.salvage}}">
      <view class="sv-head">
        <text class="label">{{vm.title}}</text>
        <text class="caption">{{vm.salvage.pending}}</text>
        <view class="hooks">
          <text class="hook {{item.left ? '' : 'hook-used'}}" ink:for="{{vm.salvage.hooks}}" ink:key="i">{{item.left ? '↓' : '·'}}</text>
        </view>
      </view>
      <view class="sea">
        <view class="card {{item.focused ? 'card-focus' : ''}} {{item.caught ? 'card-caught' : ''}}" ink:for="{{vm.salvage.items}}" ink:key="id">
          <text class="card-dist">{{item.dist}}</text>
          <image class="card-art" ink:if="{{item.art}}" src="{{item.art}}" mode="aspectFit" />
          <text class="card-tag" ink:else>{{item.tag}}</text>
          <text class="card-label">{{item.label}}</text>
          <text class="card-pct">{{item.pct}}</text>
        </view>
      </view>
      <view class="sv-back {{vm.salvage.back.focused ? 'sv-back-focus' : ''}}">
        <text class="row-mark">{{vm.salvage.back.focused ? '›' : ' '}}</text>
        <text class="row-label">返航</text>
        <text class="row-sub">收获入库</text>
      </view>
      <text class="sv-last">{{vm.salvage.last}}</text>
      <text class="caption">{{vm.salvage.hint}}</text>
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
          <view class="opts" ink:if="{{vm.overlay.opts}}">
            <view class="opt {{item.focused ? 'opt-focus' : ''}}" ink:for="{{vm.overlay.opts}}" ink:key="i">
              <text class="row-mark">{{item.focused ? '›' : ' '}}</text>
              <text class="opt-label">{{item.label}}</text>
            </view>
          </view>
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
.aptrack { flex: 1; display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 5px; }
.ap-label { font-size: 11px; color: var(--g48); margin-right: 2px; }
.pip { width: 12px; height: 8px; box-sizing: border-box; border: 1px solid var(--g48); border-radius: 2px; }
.pip-full { background-color: var(--g100); border-color: var(--g100); }
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
.reward { font-family: monospace; font-size: 16px; color: var(--g100); }

.sv-head { display: flex; flex-direction: row; justify-content: space-between; align-items: center; }
.hooks { display: flex; flex-direction: row; gap: 6px; }
.hook { font-size: 14px; color: var(--g100); }
.hook-used { color: var(--g24); }
.sea { display: flex; flex-direction: row; gap: 6px; height: 112px; }
.card {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  padding: 3px 2px; box-sizing: border-box; border: 1px solid var(--g24); border-radius: 4px;
}
.card-focus { background-color: var(--g12); border-color: var(--g100); }
.card-caught { border-style: dashed; }
.card-dist { font-size: 10px; color: var(--g48); }
.card-art { width: 56px; height: 44px; }
.card-tag { height: 44px; line-height: 44px; font-size: 26px; color: var(--g100); }
.card-caught .card-tag { color: var(--g48); }
.card-label { font-size: 11px; color: var(--g72); }
.card-focus .card-label { color: var(--g100); }
.card-pct { font-family: monospace; font-size: 12px; color: var(--g100); }
.sv-back {
  display: flex; flex-direction: row; align-items: center; gap: 6px; height: 26px; padding: 0 8px;
  box-sizing: border-box; border: 1px solid var(--g24); border-radius: 4px;
}
.sv-back-focus { background-color: var(--g12); border-color: var(--g100); }
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
.opts { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.opt { display: flex; flex-direction: row; align-items: center; gap: 6px; height: 28px; padding: 0 8px; box-sizing: border-box; border: 1px solid var(--g24); border-radius: 4px; }
.opt-focus { background-color: var(--g12); border-color: var(--g100); }
.opt-label { font-size: 14px; color: var(--g72); }
.opt-focus .opt-label { color: var(--g100); }
.dialog-action { margin-top: 6px; font-size: 11px; font-weight: 500; color: var(--g100); }
</style>
