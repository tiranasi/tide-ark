import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../agent/core/game.js';

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('new game starts on home with sane resources', () => {
  const s = G.newGame();
  assert.equal(s.day, 1);
  assert.equal(s.ui.screen, 'home');
  const vm = G.view(s);
  assert.equal(vm.menu.length, 4);
  assert.equal(vm.menu[0].focused, true);
});

test('night production: the filter makes full water with power, 30% without', () => {
  const a = G.newGame(); a.res.water = 20; a.lv.filter = 2; // 耗电 10，没有电鳗
  G.endDay(a);
  assert.equal(a.res.water, 20 - 3 + Math.floor(2 * G.NIGHT.water * 0.3));
  const b = G.newGame(); b.res.water = 20; b.lv.filter = 2; b.res.power = 10;
  G.endDay(b);
  assert.equal(b.res.water, 20 - 3 + 2 * G.NIGHT.water);
  assert.equal(b.res.power, 0);
});

test('eel generator charges at night up to the cap', () => {
  const s = G.newGame(); s.lv.eel = 1; s.lv.shelter = 2; s.lv.filter = 0; s.res.water = 20;
  G.endDay(s);
  assert.equal(s.res.power, G.NIGHT.power);
  G.press(s, 'enter');
  s.res.power = 19;
  G.endDay(s);
  assert.equal(s.res.power, G.caps(s).power);
});

test('结束今天 ends the day: AP refills, report overlay, morning checkpoint', () => {
  const s = G.newGame(); s.ap = 1;
  const menu = G.view(s).menu;
  assert.equal(menu.at(-1).label, '结束今天');
  s.ui.focus = menu.length - 1;
  G.press(s, 'enter');
  assert.equal(s.day, 2);
  assert.equal(s.ap, G.AP_MAX);
  assert.equal(s.ui.overlay.kind, 'report');
  assert.equal(s.checkpoint.day, 2);
  assert.equal(s.checkpoint.ui, undefined);
  G.press(s, 'enter');
  assert.equal(s.ui.overlay, null);
});

test('storm and thirst damage can sink the shelter, enter restarts', () => {
  const s = G.newGame();
  s.day = 20; s.res.water = 0; s.hp = 10;
  G.endDay(s);
  assert.equal(s.over, true);
  assert.equal(s.ui.overlay.kind, 'over');
  G.press(s, 'enter');
  assert.equal(s.over, false);
  assert.equal(s.day, 1);
});

test('salvage: near items are visible and sure, far ones are「？」; the haul lands on return', () => {
  const s = G.newGame();
  assert.ok(G.startSalvage(s, () => 0)); // rng 0 → 全是废料
  assert.equal(s.ap, G.AP_MAX - G.AP_COST.near);
  const sv = s.ui.salvage;
  assert.deepEqual(sv.items.map((x) => x.hidden), [false, false, true, true, true]);
  assert.deepEqual(sv.items.map((x) => x.odds), G.SLOT_ODDS);
  const vm = G.view(s).salvage;
  assert.equal(vm.items[3].tag, '？');
  assert.equal(vm.items[3].label, '看不清');
  const before = s.res.scrap;
  assert.equal(G.dropHook(s, () => 0, 0), 'scrap');
  assert.equal(s.res.scrap, before, 'not stored until the boat is back');
  assert.equal(sv.pending.length, 1);
  assert.equal(s.ui.focus, 1, 'focus skips the caught item');
  assert.equal(G.dropHook(s, () => 0.99, 4), null, 'far item slips off');
  assert.equal(sv.items[4].missed, true);
  assert.equal(sv.items[4].hidden, false);
  G.dropHook(s, () => 0, 1);
  assert.equal(sv.done, true);
  assert.equal(s.ui.focus, G.salvageReturnIdx(sv));
  G.press(s, 'enter');
  assert.equal(s.ui.screen, 'home');
  assert.equal(s.res.scrap, before + 6);
  assert.equal(s.ui.msg, '返航：#+6');
});

test('salvage: focus walks items and the 返航 row, skipping caught ones; back banks the haul', () => {
  const s = G.newGame();
  G.startSalvage(s, () => 0);
  G.press(s, 'up');
  assert.equal(s.ui.focus, 5, 'wraps to 返航');
  G.press(s, 'down');
  assert.equal(s.ui.focus, 0);
  G.dropHook(s, () => 0, 1);
  G.press(s, 'down');
  assert.equal(s.ui.focus, 2, 'skips the caught item');
  const before = s.res.scrap;
  assert.equal(G.press(s, 'back'), true);
  assert.equal(s.ui.screen, 'home');
  assert.equal(s.res.scrap, before + 3);
});

test('action points: trips cost AP, out of AP the trip is refused', () => {
  const s = G.newGame();
  for (let i = 0; i < G.AP_MAX / G.AP_COST.near; i++) { assert.ok(G.startSalvage(s, () => 0)); G.finishSalvage(s); }
  assert.equal(s.ap, 0);
  assert.equal(G.startSalvage(s, () => 0), false);
  assert.match(s.ui.msg, /行动力不够/);
  assert.equal(G.view(s).menu[0].off, true);
  s.res.scrap = 99; s.res.water = 30;
  assert.equal(G.upgrade(s, 'shelter'), false, 'building needs AP too');
});

test('upgrades respect costs and locks', () => {
  const s = G.newGame();
  assert.equal(G.upgrade(s, 'eel'), false, 'eel locked at shelter 1');
  s.res.scrap = 100; s.res.water = 30;
  assert.equal(G.upgrade(s, 'shelter'), true);
  assert.equal(s.lv.shelter, 2);
  assert.equal(G.upgrade(s, 'eel'), false, 'needs an eel');
  s.res.eels = 1;
  assert.equal(G.upgrade(s, 'eel'), true);
  assert.equal(s.lv.eel, 1);
  assert.equal(s.res.eels, 0);
  s.res.parts = 5;
  assert.equal(G.upgrade(s, 'filter'), true);
  assert.equal(G.upgrade(s, 'filter'), true);
  assert.equal(s.lv.filter, 3);
  assert.equal(G.upgrade(s, 'filter'), false, 'filter capped at shelter+1');
});

test('the ark (Lv8) waits for chapter 8 and needs filter parts', () => {
  const s = G.newGame();
  s.lv.shelter = G.MAX_SHELTER - 1;
  s.res.scrap = 999; s.res.water = 999; s.res.parts = 10;
  assert.equal(G.costOf(s, 'shelter').locked, '方舟 · 第八章');
  s.chapter = G.ENDING_CHAPTER;
  s.res.parts = 0;
  assert.equal(G.upgrade(s, 'shelter'), false, 'the ark also needs filter parts');
  s.res.parts = 10;
  assert.equal(G.upgrade(s, 'shelter'), true);
  assert.equal(G.costOf(s, 'shelter').max, true);
});

test('a chest opens with one press for 1 AP; the next press closes it', () => {
  const s = G.newGame();
  s.chests = ['iron'];
  s.ui.screen = 'chests';
  const scrap = s.res.scrap;
  G.press(s, 'enter', () => 0.5);
  assert.equal(s.ap, G.AP_MAX - G.AP_COST.chest);
  assert.ok(s.ui.chest.reward);
  assert.equal(s.chests.length, 0);
  assert.ok(s.res.scrap > scrap);
  G.press(s, 'enter');
  assert.equal(s.ui.chest, null);
  s.chests = ['wood']; s.ap = 0;
  G.press(s, 'enter');
  assert.equal(s.chests.length, 1, 'no AP, stays shut');
  assert.match(s.ui.msg, /行动力不够/);
});

test('navigation: focus wraps, back returns home, back on home is unhandled', () => {
  const s = G.newGame();
  G.press(s, 'up');
  assert.equal(s.ui.focus, 3);
  G.press(s, 'down');
  assert.equal(s.ui.focus, 0);
  G.press(s, 'down');
  G.press(s, 'enter');
  assert.equal(s.ui.screen, 'build');
  assert.equal(G.press(s, 'back'), true);
  assert.equal(s.ui.screen, 'home');
  assert.equal(s.ui.focus, 1);
  assert.equal(G.press(s, 'back'), false);
});

test('serialize/restore round trip drops ui and keeps progress', () => {
  const s = G.newGame();
  s.day = 4; s.res.scrap = 33; s.chests = ['gold'];
  const json = JSON.parse(JSON.stringify(G.serialize(s)));
  assert.equal(json.ui, undefined);
  const r = G.restore(json);
  assert.equal(r.day, 4);
  assert.equal(r.res.scrap, 33);
  assert.deepEqual(r.chests, ['gold']);
  assert.equal(r.ui.screen, 'home');
  assert.equal(G.restore(null).day, 1);
  assert.equal(G.restore({ v: 99 }).day, 1);
});

test('view model is JSON-serializable for setData', () => {
  const s = G.newGame();
  G.startSalvage(s, seq(0.1, 0.5, 0.9));
  const vm = G.view(s);
  assert.doesNotThrow(() => JSON.stringify(vm));
  assert.equal(vm.salvage.items.length, 5);
});

// ---------- M1：章节 / 居民 / 风暴季 ----------
const ack = (s) => { const ids = []; while (s.ui.overlay) { ids.push(s.ui.overlay.id || s.ui.overlay.kind); G.press(s, 'enter'); } return ids; };
const sail = (s, kindWanted) => {
  // 出海并直接钩中指定种类的物品（rng 0 → 一定钩中）
  G.press(s, 'enter'); // 主界面焦点 0 = 出海打捞
  const sv = s.ui.salvage;
  const i = sv.items.findIndex((x) => x.kind === kindWanted);
  if (i >= 0) { s.ui.focus = i; G.press(s, 'enter', () => 0); }
  G.press(s, 'back');
  s.ap = G.AP_MAX;
  return sv.items[i];
};

test('action points: once spent, focus jumps to 结束今天 back on the home screen', () => {
  const s = G.newGame(); s.chapter = 1; s.seen.ch1 = true; s.ap = G.AP_COST.near;
  G.press(s, 'enter');
  assert.equal(s.ap, 0);
  G.press(s, 'back');
  const menu = G.view(s).menu;
  assert.equal(menu[s.ui.focus].label, '结束今天');
  G.press(s, 'enter');
  assert.equal(s.day, 2);
  assert.equal(s.ap, G.AP_MAX);
});

test('sinking offers a retry from this morning; back does not wipe the save', () => {
  const s = G.newGame(); s.res.water = 20;
  G.endDay(s); ack(s); // 第 2 天早上的重来点
  s.res.scrap = 77; s.hp = 3; s.res.water = 0;
  G.endDay(s);
  assert.equal(s.ui.overlay.kind, 'over');
  assert.equal(s.ui.overlay.options.length, 2);
  assert.equal(G.press(s, 'back'), true);
  assert.equal(s.over, true, 'back is swallowed');
  G.press(s, 'enter');
  assert.equal(s.over, false);
  assert.equal(s.day, 2);
  assert.equal(s.hp, G.HP_MAX);
  assert.equal(s.res.scrap, 8, 'state from that morning');
  assert.equal(s.checkpoint.day, 2, 'can retry again');
  assert.match(s.ui.msg, /回到第 2 天早上/);
  s.hp = 3; s.res.water = 0;
  G.endDay(s);
  G.press(s, 'down'); G.press(s, 'enter'); // 从头开始
  assert.equal(s.day, 1);
  assert.equal(s.ui.overlay.id, 'prologue1');
});

test('prologue plays on first launch; first trip finishes the prologue chapter', () => {
  const s = G.restore(null);
  assert.deepEqual(ack(s), ['prologue1', 'prologue2', 'prologue3']);
  assert.equal(s.chapter, 0);
  assert.equal(G.view(s).goal.text, '出海打捞一次');
  sail(s, 'scrap');
  assert.equal(s.chapter, 1);
  assert.deepEqual(ack(s), ['ch1'], 'chapter card pops after returning, not mid-salvage');
  assert.equal(G.view(s).goal.chapter, '第一章 · 第一口淡水');
});

test('drift survivor always spawns when due and joins with a bonus', () => {
  const s = G.newGame();
  s.chapter = 1; s.day = 1;
  G.startSalvage(s, () => 0.3);
  assert.ok(!s.ui.salvage.items.some((x) => x.kind === 'drift'), 'not before day 2');
  G.finishSalvage(s);
  s.day = 2;
  const before = G.costOf(s, 'shelter').scrap;
  const it = sail(s, 'drift');
  assert.ok(it, 'container spawned');
  assert.equal(s.npc.rivet, true);
  assert.deepEqual(ack(s), ['rivet_found', 'rivet_join']);
  assert.equal(G.costOf(s, 'shelter').scrap, Math.ceil(before * 0.9));
  assert.equal(G.residents(s), 1);
  G.startSalvage(s, () => 0.3);
  assert.ok(!s.ui.salvage.items.some((x) => x.kind === 'drift'), 'only once');
});

test('chapter advances when all goals are done', () => {
  const s = G.newGame();
  s.chapter = 1; s.seen.ch1 = true;
  s.lv.filter = 2; s.npc.rivet = true; s.lv.shelter = 2;
  G.press(s, 'down');
  assert.equal(s.chapter, 2);
  assert.equal(s.ui.overlay.id, 'ch2');
  assert.ok(G.view(s).menu.length >= 0);
  ack(s);
  s.ui.screen = 'build'; s.ui.focus = 0;
  assert.equal(G.view(s).menu.length, 3, 'eel generator appears in chapter 2');
});

test('storms: none before storm season, then every 3rd night, armor defends', () => {
  const s = G.newGame();
  s.day = 3; s.res.water = 99;
  G.endDay(s);
  assert.equal(s.hp, G.HP_MAX, 'no storm before chapter 3');
  assert.equal(G.view(s).stormText, '风暴季未到');
  ack(s);

  const t = G.newGame();
  t.chapter = 3; t.seen.ch3 = true; t.day = 9; t.res.water = 99; t.lv.shelter = 3;
  assert.equal(G.view(t).stormText, `今晚风暴潮 -${G.tideOf(9) - 36}`);
  G.endDay(t);
  assert.equal(t.hp, G.HP_MAX - (G.tideOf(9) - 36));
  assert.equal(t.flags.storm, true);
  assert.deepEqual(ack(t), ['report', 'storm']);
  assert.equal(G.view(t).stormText, '2 晚后风暴潮 -' + (G.tideOf(12) - 36));
  // 藤壶装甲
  t.res.scrap = 99; t.res.parts = 5;
  assert.equal(G.upgrade(t, 'armor'), true);
  assert.equal(G.defense(t), 46);
  assert.deepEqual(ack(t), ['armor']);
  t.day = 10; G.endDay(t);
  assert.equal(t.ui.overlay.lines[1], '平静的一夜');
});

test('residents drink water; the cook offsets one share', () => {
  const made = Math.floor(G.NIGHT.water * 0.3); // 没电，过滤器 30%
  const s = G.newGame();
  s.res.water = 20; s.npc = { rivet: true, coral: true };
  G.endDay(s);
  assert.equal(s.res.water, 20 - (3 + 0 + 2) + made);
  const t = G.newGame();
  t.res.water = 20; t.npc = { rivet: true, coral: true, pot: true };
  G.endDay(t);
  assert.equal(t.res.water, 20 - (3 + 3 - 1) + made);
  assert.ok(G.rates(t).gen === 0, 'no eels, no power even with coral');
});

test('v0.1 saves migrate into chapter 1 without replaying the prologue', () => {
  const old = G.newGame();
  delete old.chapter; delete old.npc; delete old.flags; delete old.seen; delete old.queue;
  delete old.lv.armor; delete old.ui;
  const s = G.restore(old);
  assert.equal(s.chapter, 1);
  assert.equal(s.lv.armor, 0);
  assert.equal(s.ui.overlay, null);
});

// ---------- M2：第四–六章 ----------
const atChapter = (n, extra = {}) => {
  const s = G.newGame();
  s.chapter = n;
  for (let i = 0; i <= n; i++) s.seen[`ch${i}`] = true;
  Object.assign(s.flags, { storm: true, ch4Day: 1, ch6Day: 1 }, extra);
  return s;
};

test('shelter Lv5 brings the builder: +5 defense, one more resident', () => {
  const s = G.newGame();
  s.lv.shelter = 4; s.res.scrap = 999; s.res.water = 999;
  const d = G.defense(s);
  G.upgrade(s, 'shelter');
  assert.equal(s.npc.beam, true);
  assert.equal(G.defense(s), d + 12 + 5);
  assert.deepEqual(ack(s), ['outpost', 'beam_join']);
});

test('chapter 4 unlocks workshop and crane; night work runs at day end', () => {
  const s = atChapter(4);
  s.ui.screen = 'build';
  const v = G.view(s);
  assert.deepEqual(v.menu.map((m) => m.label), ['庇护所', '海水过滤器', '电鳗发电机', '藤壶装甲']);
  assert.equal(v.moreDown, true, '6 rows scroll');
  s.ui.focus = 5;
  assert.equal(G.view(s).menu.at(-1).label, '寄居蟹吊机');
  assert.equal(G.view(s).moreUp, true);
  s.lv.octo = 2; s.lv.crab = 1; s.res.scrap = 10; s.res.water = 99; s.day = 2;
  G.endDay(s);
  // 吊机 +3 → 13，工坊两次：13-8=5，第二次不够
  assert.equal(s.res.scrap, 5);
  assert.equal(s.res.parts, 1);
  assert.match(s.ui.overlay.lines[1], /吊机 #\+3  工坊 ◇\+1/);
});

test('trader visits every 3 days from the day after chapter 4 starts', () => {
  const s = atChapter(4, { ch4Day: 10 });
  const days = [10, 11, 12, 13, 14, 15, 16, 17].filter((d) => G.traderDay(s, d));
  assert.deepEqual(days, [11, 14, 17]);
  s.day = 11; s.res.scrap = 50; s.res.water = 30; s.res.parts = 5;
  G.press(s, 'down'); // 触发 progress → 商人剧情
  assert.equal(s.ui.overlay.id, 'trader');
  ack(s);
  assert.deepEqual(G.view(s).menu.map((m) => m.label).slice(3), ['秤砣', '结束今天']);
  s.ui.focus = 3; G.press(s, 'enter');
  assert.equal(s.ui.screen, 'trade');
  assert.equal(G.view(s).menu.length, 3);
  const before = { ...s.res };
  assert.equal(G.trade(s, 0), true);
  assert.notDeepEqual(s.res, before);
  assert.equal(s.ap, G.AP_MAX, 'trading is free');
  assert.equal(G.trade(s, 0), false, 'once per visit');
  assert.equal(s.flags.traded, true);
  G.press(s, 'back');
  assert.equal(s.ui.focus, 3, 'focus returns to the trader row');
  s.day = 12;
  assert.equal(G.view(s).menu.length, 4, 'trader is gone');
});

test('chapter 5: lighthouse uncle joins, turtle unlocks the wreck zone', () => {
  const s = atChapter(4);
  s.lv.shelter = 5; s.flags.traded = true; s.lv.octo = 1; s.lv.crab = 1;
  G.press(s, 'down');
  assert.equal(s.chapter, 5);
  assert.equal(s.npc.hawk, true);
  assert.deepEqual(ack(s), ['ch5', 'hawk_found', 'hawk_join']);
  assert.equal(G.view(s).goal.text, '建海龟拖船');
  s.res.scrap = 99; s.res.water = 50;
  assert.equal(G.upgrade(s, 'turtle'), true);
  assert.equal(G.costOf(s, 'turtle').locked, '沉城 · 第七章');
  ack(s);
  s.ui.screen = 'home'; s.ui.focus = 0;
  G.press(s, 'enter');
  assert.equal(s.ui.screen, 'zones');
  assert.deepEqual(G.view(s).menu.map((m) => m.label), ['近海', '残骸带']);
  G.press(s, 'down'); G.press(s, 'enter');
  assert.equal(s.ui.salvage.zone, 'wreck');
  assert.equal(s.flags.wreck, true);
  assert.equal(G.view(s).goal, null);
});

test('blueprints: a 35% chance per wreck trip, guaranteed from the 3rd, always nearest and sure', () => {
  const crewed = (s) => Object.assign(s.npc, { rivet: true, coral: true, pot: true, hawk: true }); // 没有漂流者占最近一格
  const lucky = atChapter(5); crewed(lucky); lucky.lv.turtle = 1;
  G.startSalvage(lucky, () => 0.01, 'wreck');
  assert.equal(lucky.ui.salvage.items[0].kind, 'blueprint', 'lucky roll on the 1st trip');

  const s = atChapter(5);
  crewed(s); s.lv.turtle = 1;
  const mid = () => 0.5; // 0.5 ≥ KEY_CHANCE：前两趟碰不到
  for (let trip = 1; trip <= 2; trip++) {
    G.startSalvage(s, mid, 'wreck');
    assert.ok(!s.ui.salvage.items.some((x) => x.kind === 'blueprint'));
    G.finishSalvage(s); s.ap = G.AP_MAX;
  }
  for (let n = 1; n <= 3; n++) {
    G.startSalvage(s, mid, 'wreck');
    const i = s.ui.salvage.items.findIndex((x) => x.kind === 'blueprint');
    assert.equal(i, 0, `trip ${n + 2} has a blueprint in the nearest slot`);
    const bp = s.ui.salvage.items[0];
    assert.equal(bp.tag, '!');
    assert.equal(bp.odds, 1);
    G.dropHook(s, () => 0.99, 0);
    assert.equal(s.flags.blueprint, n, 'applied at once');
    G.finishSalvage(s); s.ap = G.AP_MAX;
  }
  assert.equal(s.flags.blueprint, 3);
  G.startSalvage(s, mid, 'wreck');
  assert.ok(!s.ui.salvage.items.some((x) => x.kind === 'blueprint'), 'none once collected');
  G.finishSalvage(s);
  s.flags.wreck = true;
  G.press(s, 'down');
  assert.equal(s.chapter, 6);
});

test('shark: only far away; snaps an extra hook, costs 5 durability and half the haul', () => {
  const s = atChapter(5);
  s.lv.turtle = 1; s.npc.hawk = true; s.flags.blueprint = G.BLUEPRINTS;
  G.startSalvage(s, () => 0.99, 'wreck'); // 远处权重表最后一项 = 巨鲨
  const sv = s.ui.salvage;
  assert.ok(sv.items.slice(0, 2).every((x) => x.kind !== 'shark'), 'never near');
  const i = sv.items.findIndex((x) => x.kind === 'shark');
  assert.ok(i >= 2);
  const g = { res: { scrap: 5 }, text: '#+5' };
  sv.pending.push(g, g, g);
  G.dropHook(s, () => 0, i);
  assert.equal(sv.hooks, G.HOOKS_PER_TRIP - 2);
  assert.equal(s.hp, G.HP_MAX - 5);
  assert.equal(sv.pending.length, 1, 'ceil(3/2) taken');
  assert.match(sv.last, /叼走 2 件/);
});

test('lantern beacon raises the odds of far items', () => {
  const s = G.newGame();
  s.lv.lure = 2;
  G.startSalvage(s, () => 0.3);
  assert.deepEqual(s.ui.salvage.items.map((x) => Math.round(x.odds * 100)), [100, 90, 85, 70, 55]);
});

test('pirates: night after a storm, fight or pay, win recruits the captain', () => {
  const s = atChapter(6, { ch6Day: 5 });
  s.res.water = 99;
  assert.equal(G.pirateNight(s, 7), true);
  assert.equal(G.pirateNight(s, 4), false, 'needs 2 days of warning');
  s.day = 6;
  assert.match(G.view(s).stormText, /^今晚风暴潮/);
  s.day = 7;
  assert.equal(G.view(s).stormText, `今晚海盗 · 战力 ${G.pirateForce(s, 7)}`);
  assert.equal(G.view(s).stormDanger, true);
  // 交：-50% 废料，下次战力 +10%
  s.res.scrap = 100;
  G.endDay(s);
  assert.equal(s.ui.overlay.kind, 'raid');
  assert.equal(G.press(s, 'back'), true);
  assert.equal(s.ui.overlay.kind, 'raid', 'back does not answer');
  assert.equal(s.ui.overlay.pick, 1, 'defaults to paying when the fight is lost');
  G.press(s, 'enter');
  assert.equal(s.res.scrap, 50);
  assert.equal(s.ui.overlay.kind, 'report');
  assert.match(s.ui.overlay.lines.join('|'), /交了保护费/);
  assert.equal(G.pirateForce(s, 10), Math.round((30 + 30) * 1.1));
  ack(s);
  // 打输：-20 耐久、-30% 废料
  s.day = 10; s.hp = 100; s.res.scrap = 100;
  G.endDay(s);
  G.press(s, 'up'); // 选「打」
  G.press(s, 'enter');
  assert.equal(s.hp, 80);
  assert.equal(s.res.scrap, 70);
  ack(s);
  // 打赢：锈锚入住，海盗不再来
  s.day = 13; s.lv.shelter = 6; s.lv.armor = 3;
  assert.ok(G.defense(s) >= G.pirateForce(s, 13));
  G.endDay(s);
  G.press(s, 'enter');
  assert.equal(s.npc.rust, true);
  assert.deepEqual(ack(s), ['report', 'raid_win', 'rust_talk']);
  assert.equal(G.pirateNight(s, 16), false);
});

test('chapter 6 finishes into chapter 7, which unlocks turtle Lv2', () => {
  const s = atChapter(6);
  s.lv.lure = 1; s.npc.rust = true; s.lv.shelter = 6; s.lv.turtle = 1;
  G.press(s, 'down');
  assert.equal(s.chapter, 7);
  assert.equal(G.view(s).goal.text, '海龟拖船升到 Lv2');
  assert.equal(G.costOf(s, 'turtle').scrap, Math.ceil(90 * 1)); // 无铆钉
});

test('saves from the old chapter-4 placeholder pick up chapter 4 timers', () => {
  const old = G.newGame();
  old.chapter = 4; old.day = 20;
  const s = G.restore(JSON.parse(JSON.stringify(G.serialize(old))));
  assert.equal(s.flags.ch4Day, 20);
  assert.equal(s.lv.octo, 0);
});

// ---------- M3：第七–八章 / 结局 / 自由模式 / 存档 v2 ----------
const ALL_BEFORE_7 = { rivet: true, coral: true, pot: true, beam: true, hawk: true, rust: true };
const clearStory = (s) => { s.queue = []; s.ui.overlay = null; };

test('chapter 7: sunken city, the diver, a guaranteed keycard, then the lab', () => {
  const s = atChapter(7); Object.assign(s.npc, ALL_BEFORE_7);
  s.lv.turtle = 1; s.res.scrap = 999; s.res.water = 999; s.res.parts = 99;
  assert.equal(G.upgrade(s, 'turtle'), true);
  assert.deepEqual(ack(s), ['sunken_zone']);
  assert.deepEqual(G.zonesOf(s), ['near', 'wreck', 'sunken']);
  const mid = () => 0.5; // ≥ KEY_CHANCE：门禁卡要等第 3 趟
  // 第 1 趟：气泡的断气管必出，在最近一格；救起后沉城多 1 钩
  G.startSalvage(s, mid, 'sunken');
  const drift = s.ui.salvage.items[0];
  assert.equal(drift.kind, 'drift');
  assert.equal(drift.npc, 'bubble');
  G.dropHook(s, mid, 0);
  assert.equal(s.npc.bubble, true);
  assert.ok(s.seen.bubble_found);
  G.finishSalvage(s); s.ap = G.AP_MAX;
  // 第 2 趟：4 钩，还没有门禁卡
  G.startSalvage(s, mid, 'sunken');
  assert.equal(s.ui.salvage.hooks, G.HOOKS_PER_TRIP + 1);
  assert.equal(G.view(s).salvage.hooks.length, G.HOOKS_PER_TRIP + 1);
  assert.ok(!s.ui.salvage.items.some((x) => x.kind === 'keycard'));
  G.finishSalvage(s); s.ap = G.AP_MAX;
  // 第 3 趟：门禁卡必出
  G.startSalvage(s, mid, 'sunken');
  assert.equal(s.ui.salvage.items[0].kind, 'keycard', 'keycard forced on the 3rd trip');
  G.dropHook(s, mid, 0);
  assert.equal(s.flags.keycard, true);
  G.finishSalvage(s); s.ap = G.AP_MAX;
  clearStory(s);
  // 海域列表多出实验室；下潜后进入第八章
  assert.deepEqual(G.zonesOf(s), ['near', 'wreck', 'sunken', 'lab']);
  G.press(s, 'enter');
  assert.equal(s.ui.screen, 'zones');
  G.press(s, 'up'); // 回绕到最后一项：实验室
  assert.equal(G.view(s).menu.at(-1).label, '沉没实验室');
  G.press(s, 'enter');
  assert.equal(s.flags.lab, true);
  assert.equal(s.ap, G.AP_MAX - G.AP_COST.lab);
  assert.equal(s.ui.screen, 'home');
  assert.equal(s.chapter, 8);
  assert.deepEqual(ack(s), ['lab', 'lin', 'tidesong', 'truth', 'ch8', 'engine']);
  assert.ok(!G.zonesOf(s).includes('lab'), 'one dive only');
  assert.equal(G.residents(s), Object.keys(s.npc).length);
  assert.ok(!s.npc.lin, 'lab survivors do not drink from the shelter');
});

test('jellyfish lights up the sea: every「？」is revealed', () => {
  const s = G.newGame();
  s.lv.turtle = 2;
  G.startSalvage(s, () => 0.999, 'sunken'); // 远处权重表最后一项 = 水母
  const sv = s.ui.salvage;
  const j = sv.items.findIndex((x) => x.kind === 'jelly');
  assert.ok(j >= G.NEAR_SLOTS, 'only far away');
  assert.ok(sv.items.some((x) => x.hidden));
  G.dropHook(s, () => 0, j);
  assert.ok(sv.items.every((x) => !x.hidden));
});

test('octopus nights: after the sunken city opens, storms hit 20% harder', () => {
  const s = G.newGame();
  s.chapter = 7; s.seen.ch3 = true; s.seen.ch7 = true; s.day = 30; s.res.water = 99;
  s.lv.shelter = 7; s.lv.armor = 3; // 防 114，潮 130
  const base = G.tideOf(30) - G.defense(s);
  assert.ok(base > 0);
  assert.equal(G.stormDamage(s, 30), base);
  s.lv.turtle = 2;
  assert.equal(G.stormDamage(s, 30), Math.round(base * 1.2));
  const hp = s.hp;
  G.endDay(s);
  assert.equal(s.hp, Math.max(0, hp - Math.round(base * 1.2)));
  assert.match(s.ui.overlay.lines.join(' '), /风暴潮\+章鱼 -/);
  const order = ack(s);
  assert.ok(order.includes('octopus_night'));
  assert.ok(order.indexOf('octopus_night') > order.indexOf('report'));
});

test('bottle letters: a line from another drifter, rotating through 10', () => {
  const s = G.newGame();
  s.seen.prologue = true;
  for (let i = 0; i < 11; i++) {
    G.startSalvage(s, () => 0.999, 'near'); // 近海权重表最后一项 = 漂流瓶
    const sv = s.ui.salvage;
    const b = sv.items.findIndex((x) => x.kind === 'letter');
    assert.ok(b >= 0, 'letter spawned');
    G.dropHook(s, () => 0, b);
    assert.equal(sv.last, `漂流瓶：「${G.LETTERS[i % 10]}」`);
    assert.deepEqual(sv.haul, ['漂流瓶']);
    G.finishSalvage(s, true);
    s.ap = G.AP_MAX;
  }
  assert.equal(s.flags.letters, 11);
});

const toArk = () => {
  const s = atChapter(8);
  Object.assign(s.npc, ALL_BEFORE_7, { bubble: true });
  s.lv.shelter = 7; s.res.scrap = 999; s.res.water = 50; s.res.parts = 99;
  assert.equal(G.upgrade(s, 'shelter'), true);
  G.press(s, 'down'); // progress → 方舟建成
  return s;
};

test('ending: the ark, Baisha, broadcast → free mode with daily scrap and no sinking', () => {
  const s = toArk();
  assert.deepEqual(ack(s), ['ark', 'confront', 'choice', 'end_broadcast', 'hook']);
  assert.equal(s.ending, 'broadcast');
  assert.equal(s.chapter, G.CHAPTER_COUNT - 1);
  assert.equal(G.view(s).goal.text, '广播结局 · 每天 #+10');
  s.day = 30; s.hp = 5; s.res.water = 0; s.res.scrap = 0;
  G.endDay(s);
  assert.equal(s.over, false);
  assert.equal(s.hp, 1);
  assert.equal(s.res.scrap, 10);
});

test('ending: handing over the plans means no more drinking water cost', () => {
  const s = toArk();
  assert.equal(s.ui.overlay.id, 'ark'); G.press(s, 'enter');
  assert.equal(s.ui.overlay.id, 'confront'); G.press(s, 'enter');
  assert.equal(s.ui.overlay.kind, 'choice');
  assert.equal(G.press(s, 'back'), true, 'back is swallowed, does not exit');
  assert.equal(s.ui.overlay.kind, 'choice', 'and does not answer');
  assert.equal(s.ending, null);
  G.press(s, 'down'); G.press(s, 'enter');
  assert.equal(s.ending, 'deal');
  assert.deepEqual(ack(s), ['end_deal', 'hook']);
  G.endDay(s);
  assert.match(s.ui.overlay.lines[0], /^饮水 ≈-0 /);
});

test('a choice lost to a save is asked again after loading', () => {
  const s = toArk();
  G.press(s, 'enter'); G.press(s, 'enter');
  assert.equal(s.ui.overlay.kind, 'choice');
  const r = G.restore(JSON.parse(JSON.stringify(G.serialize(s))));
  assert.equal(r.ui.overlay.kind, 'choice');
  assert.equal(r.ending, null);
});

test('v2 (real-time) saves load into the AP model', () => {
  const old = G.newGame();
  Object.assign(old, { v: 2, clock: 40, cooldown: 3, returns: [{ npc: 'rivet' }], crew: { rivet: { zone: 'wreck', left: 12 } } });
  delete old.ap; delete old.checkpoint; delete old.ui;
  old.npc.rivet = true;
  const s = G.restore(JSON.parse(JSON.stringify(old)));
  assert.equal(s.v, G.SAVE_VERSION);
  assert.equal(s.ap, G.AP_MAX);
  assert.deepEqual(s.crew, { rivet: { zone: 'wreck' } });
  for (const k of ['clock', 'cooldown', 'returns']) assert.equal(k in s, false, k);
});

test('saves are v3; v0.1 saves infer the chapter from levels', () => {
  assert.equal(G.newGame().v, 3);
  const old = G.newGame();
  delete old.chapter; delete old.npc; delete old.flags; delete old.seen; delete old.queue; delete old.ui; delete old.ending;
  old.v = 1; old.won = true; old.arkSeen = true;
  Object.assign(old.lv, { shelter: 4, filter: 3, eel: 2 });
  const s = G.restore(JSON.parse(JSON.stringify(old)));
  assert.equal(s.v, G.SAVE_VERSION);
  assert.equal(s.chapter, 4);
  assert.deepEqual(Object.keys(s.npc).sort(), ['coral', 'pot', 'rivet']);
  assert.equal(s.flags.ch4Day, s.day);
  assert.equal(s.ui.overlay, null, 'nothing replays');
  assert.equal('won' in s, false);
});

// ---------- 居民派遣与聊天 ----------
const crewGame = () => { const s = G.newGame(); s.npc.rivet = true; s.res.water = 10; return s; };

test('crew: home shows 居民 once someone lives aboard; enter → list → resident page', () => {
  const s = G.newGame();
  assert.ok(!G.view(s).menu.some((m) => m.label === '居民'));
  s.npc.rivet = true;
  const idx = G.view(s).menu.findIndex((m) => m.label === '居民');
  assert.equal(idx, 3, 'after 宝箱');
  s.ui.focus = idx;
  G.press(s, 'enter');
  assert.equal(s.ui.screen, 'crew');
  assert.equal(G.view(s).menu[0].label, '铆钉');
  G.press(s, 'enter');
  assert.equal(s.ui.screen, 'mate');
  const vm = G.view(s);
  assert.deepEqual(vm.menu.map((m) => m.label), ['派遣 · 近海', '聊聊']);
  G.press(s, 'back');
  assert.equal(s.ui.screen, 'crew');
  G.press(s, 'back');
  assert.equal(s.ui.screen, 'home');
  assert.equal(s.ui.focus, idx, 'focus returns to 居民');
});

test('crew: dispatch costs water but no AP; the haul comes back at night inside the report', () => {
  const s = crewGame();
  s.ui.screen = 'mate'; s.ui.mate = 'rivet'; s.ui.focus = 0;
  G.press(s, 'enter');
  assert.equal(s.res.water, 10 - G.DISPATCH_WATER);
  assert.equal(s.ap, G.AP_MAX, 'free action');
  assert.deepEqual(s.crew.rivet, { zone: 'near' });
  assert.equal(s.ui.screen, 'crew');
  assert.equal(G.dispatch(s, 'rivet', 'near'), false, 'already away');
  const scrap = s.res.scrap;
  G.endDay(s, () => 0); // rng 0 → 废料
  assert.ok(!s.crew.rivet);
  assert.equal(s.res.scrap, scrap + 3);
  assert.equal(s.ui.overlay.kind, 'report');
  assert.ok(s.ui.overlay.lines.includes('派遣 1 人：#+3'), s.ui.overlay.lines.join('|'));
  assert.equal(s.bond.rivet, 1);
});

test('crew: no water, no dispatch', () => {
  const s = crewGame(); s.res.water = 1;
  assert.equal(G.dispatch(s, 'rivet', 'near'), false);
  assert.match(s.ui.msg, /口粮不够/);
});

test('crew: specialty zone and bond ≥3 each add one item', () => {
  const s = crewGame();
  assert.equal(G.dispatchSize(s, 'rivet', 'near'), 1);
  assert.equal(G.dispatchSize(s, 'rivet', 'wreck'), 2);
  s.bond.rivet = 3;
  assert.equal(G.dispatchSize(s, 'rivet', 'wreck'), 3);
});

test('crew: a shark costs one item', () => {
  const s = crewGame(); s.lv.turtle = 1; s.chapter = 5;
  assert.ok(G.zonesOf(s).includes('wreck'));
  G.dispatch(s, 'rivet', 'wreck');
  G.endDay(s, () => 0.999); // 残骸带权重表最后一项 → 巨鲨
  const line = s.ui.overlay.lines.find((l) => l.startsWith('派遣'));
  assert.equal(line, '派遣 1 人：空手 · 遇鲨丢 2');
});

test('crew: several residents merge into one report line', () => {
  const s = crewGame(); s.npc.coral = true; s.res.water = 20;
  G.dispatch(s, 'rivet', 'near');
  G.dispatch(s, 'coral', 'near');
  G.endDay(s, () => 0);
  assert.ok(s.ui.overlay.lines.some((l) => /^派遣 2 人：#\+\d+$/.test(l)), s.ui.overlay.lines.join('|'));
});

test('crew: talk rotates lines, bond +1 once per day, warns on a dangerous night', () => {
  const s = crewGame();
  G.talk(s, 'rivet');
  assert.equal(s.ui.overlay.kind, 'talk');
  assert.equal(s.ui.overlay.lines[0], `「${G.CREW.rivet.lines[0]}」`);
  assert.equal(s.bond.rivet, 1);
  s.ui.overlay = null;
  G.talk(s, 'rivet');
  assert.equal(s.ui.overlay.lines[0], `「${G.CREW.rivet.lines[1]}」`);
  assert.equal(s.bond.rivet, 1, 'same day');
  s.ui.overlay = null;
  s.chapter = G.STORM_CHAPTER; s.day = 3; s.lv.shelter = 1;
  G.talk(s, 'rivet');
  assert.equal(s.ui.overlay.lines[0], `「${G.CREW.rivet.warn}」`);
  assert.equal(s.bond.rivet, 2, 'new day');
});

test('crew: away residents cannot talk', () => {
  const s = crewGame();
  G.dispatch(s, 'rivet', 'near');
  assert.equal(G.talk(s, 'rivet'), false);
});

test('crew: save round trip keeps crew and bond', () => {
  const s = crewGame();
  G.dispatch(s, 'rivet', 'near');
  s.bond.rivet = 2;
  const r = G.restore(JSON.parse(JSON.stringify(G.serialize(s))));
  assert.deepEqual(r.crew.rivet, { zone: 'near' });
  assert.equal(r.bond.rivet, 2);
  assert.equal(r.ui.overlay, null);
});

test('crew: LLM prompt carries persona and state, the model only supplies words', () => {
  const s = crewGame();
  G.talk(s, 'rivet');
  const p = G.talkPrompt(s, s.ui.overlay);
  assert.ok(p.system.includes(G.CREW.rivet.persona));
  assert.ok(p.user.includes('第1天'));
  assert.equal(p.voice, 'male-qn-qingse');
  assert.equal(p.fallback, s.ui.overlay.lines[0]);
  assert.equal(G.clipLine('「一二三四五六七八九十一二三四五六七」'), '一二三四五六七八九十一二三四五…');
});
