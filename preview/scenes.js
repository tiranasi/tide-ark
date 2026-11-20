// 截图用的固定场景：?scene=NAME&shot=1 打开预览时，用这里构造的状态替换存档（不写存档）。
// 每个场景只用 game.js 的公开函数和直接改状态来搭，不按键（避免触发章节推进）。
// tools/shots.mjs 按这里的顺序逐个截图，生成 docs/screenshots/。

// 固定种子随机数，保证每次截图一样
export function seeded(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 第六章、第 19 天：5 位居民、商人在、今晚海盗
function late(G) {
  const s = G.newGame();
  Object.assign(s, { chapter: 6, day: 19, ap: 4, hp: 88 });
  Object.assign(s.lv, { shelter: 5, filter: 4, eel: 3, armor: 1, octo: 1, crab: 1, turtle: 1 });
  Object.assign(s.res, { scrap: 64, water: 31, power: 18, parts: 5, eels: 2 });
  for (const k of ['rivet', 'coral', 'pot', 'beam', 'hawk']) s.npc[k] = true;
  Object.assign(s.flags, { ch4Day: 12, ch6Day: 17, wreck: true, blueprints: 3 });
  for (const id of ['wreck_zone', 'trader', 'storm', 'shark']) s.seen[id] = true;
  Object.assign(s.bond, { rivet: 3, coral: 2, pot: 4, beam: 1, hawk: 0 });
  s.ui.msg = '第 19 天。黑帆在远处。';
  return s;
}
// 第七章：沉城已开，锈锚已入住（不再有海盗）
function deep(G) {
  const s = late(G);
  Object.assign(s, { chapter: 7, day: 21 });
  Object.assign(s.lv, { shelter: 6, armor: 2, turtle: 2, lure: 1 });
  s.npc.rust = true;
  s.flags.storm = true;
  return s;
}

export const SCENES = [
  // ---------- 开场与主界面 ----------
  ['01-prologue', '序章剧情弹窗（第一次打开）', (G) => G.restore(undefined)],
  ['02-home-ch1', '主界面 · 第一章', (G) => {
    const s = G.newGame(); s.ui.msg = '确认 · 出海打捞。'; return s;
  }],
  ['03-home-storm', '主界面 · 风暴预报（第三章）', (G) => {
    const s = G.newGame();
    Object.assign(s, { chapter: 3, day: 5, ap: 3 });
    Object.assign(s.lv, { shelter: 3, filter: 3, eel: 2, armor: 0 });
    Object.assign(s.res, { scrap: 22, water: 14, power: 9, parts: 2, eels: 1 });
    s.npc.rivet = true; s.npc.coral = true;
    s.ui.focus = 1;
    return s;
  }],
  ['04-home-late', '主界面 · 居民 + 商人（6 项，紧凑行）', (G) => { const s = late(G); s.ui.focus = 4; return s; }],
  ['05-story-rivet', '剧情弹窗 · 说话人立绘', (G) => {
    const s = G.newGame();
    s.ui.overlay = { kind: 'story', id: 'rivet_found', title: '集装箱里有人',
      lines: ['「咳……谢了。我叫铆钉。」', '「城邦说我修坏了配给阀，', '把我锁进箱子扔了。」'], action: '确认 · 继续' };
    return s;
  }],

  // ---------- 出海 ----------
  ['06-zones', '选择海域', (G) => { const s = deep(G); s.ui.screen = 'zones'; s.ui.focus = 1; return s; }],
  ['07-salvage', '打捞 · 选目标（近处看得清，远处是「？」）', (G) => {
    const s = G.newGame(); s.day = 2;
    G.startSalvage(s, seeded(3));
    s.ui.focus = 2;
    return s;
  }],
  ['08-salvage-hit', '打捞 · 钩中一件，见好就收？', (G) => {
    const s = G.newGame(); s.day = 2;
    G.startSalvage(s, seeded(3));
    G.dropHook(s, () => 0, 0);
    return s;
  }],
  ['09-salvage-letter', '打捞 · 漂流瓶', (G) => {
    const s = G.newGame(); s.day = 2;
    G.startSalvage(s, seeded(3));
    const sv = s.ui.salvage;
    sv.items[1] = { ...sv.items[1], kind: 'letter', label: '漂流瓶', tag: '○' };
    s.ui.focus = 1;
    G.dropHook(s, () => 0);
    return s;
  }],
  ['10-salvage-wreck', '打捞 · 残骸带', (G) => {
    const s = late(G);
    G.startSalvage(s, seeded(11), 'wreck');
    G.dropHook(s, () => 0, 0);
    s.ui.focus = 3;
    return s;
  }],

  // ---------- 建造 / 宝箱 / 商人 ----------
  ['11-build', '建造与升级（滚动列表）', (G) => { const s = late(G); s.ui.screen = 'build'; s.ui.focus = 2; return s; }],
  ['12-chests', '宝箱列表', (G) => {
    const s = late(G); s.chests = ['wood', 'iron', 'gold']; s.ui.screen = 'chests'; s.ui.focus = 1; return s;
  }],
  ['13-chest-open', '开箱', (G) => {
    const s = late(G); s.chests = ['wood', 'iron', 'gold']; s.ui.screen = 'chests'; s.ui.focus = 1;
    s.chests.splice(1, 1); s.ui.chest = { kind: 'iron', reward: '#+11  ◇+2' };
    return s;
  }],
  ['14-trade', '商人秤砣', (G) => { const s = late(G); s.ui.screen = 'trade'; return s; }],

  // ---------- 居民：派遣与聊天（新） ----------
  ['15-crew', '居民列表 · 珊瑚出海中', (G) => {
    const s = late(G); s.crew.coral = { zone: 'near' }; s.flags.talked_rivet = 19;
    s.ui.screen = 'crew'; s.ui.focus = 0; return s;
  }],
  ['16-mate', '居民页 · 派遣海域 / 聊聊', (G) => {
    const s = late(G); s.ui.screen = 'mate'; s.ui.mate = 'rivet'; s.ui.focus = 1; return s;
  }],
  ['17-mate-nowater', '居民页 · 缺水不能派', (G) => {
    const s = late(G); s.res.water = 1; s.ui.screen = 'mate'; s.ui.mate = 'pot'; s.ui.focus = 0; return s;
  }],
  ['18-crew-back', '派遣归来并入早上的结算', (G) => {
    const s = late(G);
    G.dispatch(s, 'rivet', 'wreck');
    G.dispatch(s, 'pot', 'near');
    s.day = 20; // 平静的一夜
    G.endDay(s, seeded(5));
    return s;
  }],
  ['19-talk', '聊聊 · 平常', (G) => {
    const s = deep(G); s.day = 22; G.talk(s, 'coral'); return s;
  }],
  ['20-talk-warn', '聊聊 · 危险夜提醒', (G) => { const s = late(G); G.talk(s, 'beam'); return s; }],

  // ---------- 夜晚与结局 ----------
  ['21-report', '每日结算', (G) => {
    const s = G.newGame(); s.res.water = 12; G.endDay(s); return s;
  }],
  ['22-report-octopus', '结算 · 风暴潮 + 章鱼', (G) => { const s = deep(G); s.lv.armor = 0; G.endDay(s); return s; }],
  ['23-octopus', '剧情 · 巨型章鱼', (G) => {
    const s = deep(G);
    s.ui.overlay = { kind: 'story', id: 'octopus_night', title: '巨型章鱼',
      lines: ['沉城里的东西跟着你浮了上来。', '风暴夜，触手拍打着船体。', '从今往后，风暴潮伤害 +20%。'], action: '确认 · 继续' };
    return s;
  }],
  ['24-raid', '海盗夜 · 打或交', (G) => { const s = late(G); G.endDay(s); return s; }],
  ['25-choice', '终章二选一', (G) => {
    const s = deep(G); Object.assign(s, { chapter: 8, day: 34 }); s.lv.shelter = 8;
    s.queue = ['choice'];
    return G.restore(JSON.parse(JSON.stringify(G.serialize(s))));
  }],
  ['26-free', '自由漂流（广播结局后）', (G) => {
    const s = deep(G); Object.assign(s, { chapter: 9, day: 41, ending: 'broadcast' }); s.lv.shelter = 8;
    for (const k of ['rust', 'bubble']) s.npc[k] = true;
    s.ui.msg = '第一幕完。方舟继续漂流。';
    return s;
  }],
  ['27-over', '沉没 · 从当天早上重来', (G) => {
    const s = G.newGame(); s.day = 20;
    s.checkpoint = JSON.parse(JSON.stringify(G.serialize(s)));
    Object.assign(s, { hp: 8 }); s.res.water = 0; G.endDay(s); return s;
  }],
  ['28-tired', '行动力用完 · 焦点在「结束今天」', (G) => {
    const s = late(G); s.ap = 0; s.ui.focus = 6; s.ui.msg = '返航：#+14 ◇+1  行动力用完了。'; return s;
  }],
];
