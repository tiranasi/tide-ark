// 潮汐方舟 — 纯游戏逻辑。无平台依赖，AIUI 页面与浏览器预览共用。
// 所有函数直接修改传入的 state；rng 可注入以便测试。
import { ART } from './art.js';

// 回合制：每天固定行动力，用完（或主动「结束今天」）进入夜晚结算。没有实时计时。
export const AP_MAX = 6;
export const AP_COST = { near: 2, wreck: 3, sunken: 4, lab: 2, build: 1, repair: 1, chest: 1 };
export const MAX_SHELTER = 8;
export const HP_MAX = 100;
export const HOOKS_PER_TRIP = 3;
export const REPAIR_COST = 5;
export const REPAIR_HP = 20;
export const SAVE_KEY = 'tideark.save.v1'; // 键不变；存档内的 v 才是版本号
export const SAVE_VERSION = 3;

// docs/系统设计.md §8：Lv5 起更贵，匹配新增的被动产出
const SHELTER_SCRAP = [10, 25, 40, 70, 110, 160, 240];
const SHELTER_WATER = [5, 8, 12, 18, 25, 35, 50];
const ARK_PARTS = 10; // 升到 Lv8 额外要滤芯

export const SYM = { scrap: '#', water: '≈', power: 'ϟ', parts: '◇', eels: '∿' };
const RES_LABEL = { scrap: '废料', water: '淡水', power: '电力', parts: '滤芯', eels: '电鳗' };

const LOOT = [
  { kind: 'scrap', w: 45, label: '废料', tag: '#' },
  { kind: 'bottle', w: 18, label: '水瓶', tag: '≈' },
  { kind: 'part', w: 14, label: '滤芯', tag: '◇' },
  { kind: 'chest', w: 11, label: '宝箱', tag: '□' },
  { kind: 'eel', w: 5, label: '电鳗', tag: '∿' },
  { kind: 'weed', w: 7, label: '海藻', tag: '·' },
  { kind: 'letter', w: 3, label: '漂流瓶', tag: '○' },
];
// 残骸带：废料多、有图纸碎片（只在第五章且没集齐时出现）、有巨鲨
const WRECK_LOOT = [
  { kind: 'scrap', w: 50, label: '废料', tag: '#' },
  { kind: 'part', w: 18, label: '滤芯', tag: '◇' },
  { kind: 'chest', w: 14, label: '宝箱', tag: '□' },
  { kind: 'eel', w: 8, label: '电鳗', tag: '∿' },
  { kind: 'blueprint', w: 5, label: '图纸碎片', tag: '?' },
  { kind: 'letter', w: 3, label: '漂流瓶', tag: '○' },
  { kind: 'shark', w: 5, label: '变异巨鲨', tag: '▲' },
];
// 沉城：宝箱只有铁/金、有门禁卡（第七章、气泡入住后）、巨鲨、发光水母
const SUNKEN_LOOT = [
  { kind: 'scrap', w: 40, label: '废料', tag: '#' },
  { kind: 'part', w: 20, label: '滤芯', tag: '◇' },
  { kind: 'chest', w: 18, label: '宝箱', tag: '□' },
  { kind: 'eel', w: 10, label: '电鳗', tag: '∿' },
  { kind: 'keycard', w: 5, label: '门禁卡', tag: '?' },
  { kind: 'letter', w: 3, label: '漂流瓶', tag: '○' },
  { kind: 'shark', w: 4, label: '变异巨鲨', tag: '▲' },
  { kind: 'jelly', w: 3, label: '发光水母', tag: '*' },
];
// 漂流瓶：其他漂流者的一句话，纯氛围，按捞到的次数轮换
export const LETTERS = [
  '今天又捞到一只鞋。左脚。',
  '谁有滤芯？换一条鱼。',
  '孩子问我陆地长什么样。',
  '海鸥偷了我的午饭。',
  '第 300 天，还活着。',
  '如果你读到这个，往东有淡水。',
  '我把房子拆了，造了船。',
  '城邦的灯，晚上真好看。',
  '别吃那种发光的鱼。',
  '我们会再见到陆地的。',
];
const RARE = new Set(['part', 'chest', 'eel', 'blueprint', 'keycard']);
export const BLUEPRINTS = 3;

// 海域（§7）。实验室不是打捞海域：拿到门禁卡后出现在海域列表里，下潜一次播放剧情
const ZONES = {
  near: { label: '近海', sub: '安全 · 废料、淡水', loot: LOOT },
  wreck: { label: '残骸带', sub: '废料多 · 有巨鲨 · 图纸碎片', loot: WRECK_LOOT },
  sunken: { label: '沉城', sub: '铁箱金箱 · 巨鲨 · 门禁卡', loot: SUNKEN_LOOT },
  lab: { label: '沉没实验室', sub: '门禁卡 · 下潜' },
};
export function zonesOf(s) {
  const list = ['near'];
  if (s.lv.turtle >= 1) list.push('wreck');
  if (s.lv.turtle >= 2) list.push('sunken');
  if (s.flags.keycard && !s.flags.lab) list.push('lab');
  return list;
}
// 剧情物：只在需要时出现；在对应章节第 3 次进入该海域起必出（§7 防卡关）
const KEY_ITEM = {
  wreck: { kind: 'blueprint', label: '图纸碎片', tag: '?', trips: 'wreckTrips', need: (s) => needBlueprint(s) },
  sunken: { kind: 'keycard', label: '门禁卡', tag: '?', trips: 'sunkenTrips', need: (s) => needKeycard(s) },
};
const needKeycard = (s) => s.chapter >= 7 && !!s.npc.bubble && !s.flags.keycard;

const CHEST = {
  wood: { label: '木箱' },
  iron: { label: '铁箱' },
  gold: { label: '金箱' },
};

// 深蓝纪元的庇护所时代（见 docs/设计文档.md「世界观」）
const ERAS = [[1, '木筏时代'], [3, '生存时代'], [5, '电气时代'], [7, '工业时代'], [8, '方舟']];
export function eraOf(lv) { let e = ERAS[0][1]; for (const [min, name] of ERAS) if (lv >= min) e = name; return e; }

// ---------- 剧情（台词以 docs/故事.md 为准） ----------
// art 可以是数组：取第一张已就绪的线稿（角色线稿未生成时退回剧情插画）
const STORY = {
  prologue1: { art: 'story-01', title: '大淹没', lines: ['公元 2147 年，海平面失控上涨。', '城市、平原与工厂相继沉没。', '人们把之后的日子叫作深蓝纪元。'] },
  prologue2: { art: ['npc-06', 'story-02'], title: '深蓝纪元 183 年', lines: ['「淡水配给费，又欠了三期。」', '「规则不是我定的，但我执行它。」', '配给官白砂在你的名字上盖了章。'] },
  prologue3: { art: 'story-02', title: '外海', lines: ['他们给了你一块木筏、几根废料，', '和一台坏掉的过滤器。', '每天力气有限。出海打捞吧。'] },
  part: { art: 'story-03', title: '第一枚滤芯', lines: ['旧世界的滤芯，外壳都锈了，', '芯子还是好的。', '装进过滤器试试。'] },
  filter: { art: 'story-04', title: '第一口淡水', lines: ['过滤器滴下了干净的水。', '你想起白砂盖章的样子。', '水，原来是可以自己造的。'] },
  rivet_found: { art: ['npc-02', 'story-03'], title: '集装箱里有人', lines: ['「咳……谢了。我叫铆钉。」', '「城邦说我修坏了配给阀，', '把我锁进箱子扔了。」'] },
  rivet_join: { art: ['npc-02', 'story-03'], title: '铆钉', lines: ['「你这木筏，钉子全钉歪了。」', '「让我来。能拆的就能装回去。」', '铆钉入住：建造废料 −10%'] },
  eel: { art: 'story-05', title: '网里的电鳗', lines: ['它在网里噼啪作响。', '这玩意儿的电，', '够点亮一整座庇护所。'] },
  coral_found: { art: ['npc-04', 'story-05'], title: '采样舱', lines: ['舱里是个昏迷的女人，', '怀里护着一本潮湿的笔记。', '她醒来第一句话：', '「电鳗还活着吗？」'] },
  coral_join: { art: ['npc-04', 'story-05'], title: '珊瑚', lines: ['「研究会要把它们做成电池。」', '「它们不是怪物，', '是被逼着变的。」', '珊瑚入住：发电 +20%'] },
  power: { art: 'story-06', title: '第一盏灯', lines: ['灯亮了。远处有船在看你。', '铆钉：「从今晚起，', '我们是海上的一颗星了。」'] },
  storm_season: { art: 'event-04', title: '风暴季', lines: ['珊瑚：「海鸟都往南飞了。」', '每隔三晚，潮水会来一次大的。', '主界面会提前告诉你是哪一晚。'] },
  storm: { art: 'story-08', title: '熬过风暴潮', lines: ['潮水退去，补丁还在。', '铆钉在木板上划了一道：', '「下次，让它连补丁都碰不到。」'] },
  armor: { art: 'barnacle-lv1-front', title: '藤壶装甲', lines: ['珊瑚：「藤壶会自己长，', '越长越厚。」', '风暴潮伤害降低了。'] },
  pot_found: { art: ['npc-07', 'story-08'], title: '小舢板', lines: ['「别开枪！我只带了一口锅！」', '「后厨说我偷喝了汤。', '我就喝了一口！」'] },
  pot_join: { art: ['npc-07', 'story-08'], title: '小锅', lines: ['「饿着肚子，', '什么都想不明白。」', '小锅入住：每日饮水 −1'] },
  outpost: { art: 'story-09', title: '新的邻居', lines: ['几条小船在夜里靠了过来。', '他们也是被城邦赶出来的。', '你的木筏，开始像一座城了。'] },
  // 第四章
  beam_join: { art: ['npc-11', 'story-09'], title: '铁梁', lines: ['一个人扛着钢梁走上甲板，', '量了三遍你的地基，', '只说了一句：「能盖七层。」', '铁梁入住：风暴防御 +5'] },
  trader: { art: ['npc-10', 'story-09'], title: '秤砣', lines: ['「废料换滤芯，淡水换电鳗。」', '「价格从不便宜，', '货从不掺假。三天后见。」'] },
  octo: { art: 'octo-lv1-front', title: '章鱼工坊', lines: ['铆钉和珊瑚吵了一整晚，', '最后章鱼赢了：', '它拧螺丝比铆钉还快。', '每晚把 #8 拧成 ◇1'] },
  crab: { art: 'crab-lv1-front', title: '寄居蟹吊机', lines: ['寄居蟹搬进了旧吊机的壳。', '它整夜在水下翻找，', '天亮时总会带回点什么。'] },
  // 第五章
  hawk_found: { art: ['npc-03', 'turtle-lv1-front'], title: '海龟上的老头', lines: ['一只大海龟停在庇护所旁，', '背上坐着个木腿老头。', '「这片海，我在上面开过车。」'] },
  hawk_join: { art: ['npc-03', 'turtle-lv1-front'], title: '灯塔叔', lines: ['「近海早被捞空了。', '往北，是旧城的残骸带。」', '「给海龟套上拖架，我带路。」', '解锁：海龟拖船'] },
  turtle: { art: 'turtle-lv1-front', title: '海龟拖船', lines: ['海龟拖着木筏往北游。', '出海时可以选海域了。'] },
  wreck_zone: { art: ['place-03', 'story-09'], title: '残骸带', lines: ['半截高楼从水里伸出来，', '楼顶还挂着旧世界的广告牌。', '灯塔叔：「别看了，捞。」'] },
  shark: { art: ['lore-03', 'event-04'], title: '变异巨鲨', lines: ['水下有一道比船还长的影子。', '它咬断了钩索，还叼走了半船收获。', '灯塔叔：「看不清的，别乱下钩。」'] },
  blueprint1: { art: ['lore-02', 'story-05'], title: '图纸碎片 1/3', lines: ['一张泡烂的工程图，', '角落盖着一个波浪形印章：', '「深蓝计划」。'] },
  blueprint2: { art: ['lore-02', 'story-05'], title: '图纸碎片 2/3', lines: ['第二片图纸。', '线条连起来了，', '像是某种巨大的发电机。'] },
  blueprint3: { art: ['lore-02', 'story-05'], title: '发电机图纸', lines: ['铆钉：「这是电鳗发电机……', '但比我们的大一百倍。」', '图纸签名：林。'] },
  // 第六章
  pirate_warn: { art: ['npc-05', 'place-04', 'event-04'], title: '黑帆', lines: ['灯塔叔放下望远镜：', '「锈锚的船。他闻到灯光了。」', '海盗会在风暴后的那一晚来。'] },
  raid_win: { art: ['npc-05', 'story-08'], title: '黑帆退了', lines: ['锈锚的船停在射程外，', '打出一面白旗。', '他想谈谈。'] },
  rust_talk: { art: ['npc-05', 'story-08'], title: '锈锚', lines: ['「十年前，白砂也给我盖过章。」', '「你造你的城，我不碰。」', '「要找城邦算账时，叫我。」', '海盗不再来袭 · 防御 +5'] },
  lure: { art: 'lure-lv1-front', title: '灯笼鱼信标', lines: ['深海的光照进了浅海。', '好东西开始往你这边漂。', '远处更容易钩中，稀有物更多'] },
  // 第七章
  industry: { art: ['npc-06', 'place-05'], title: '来信', lines: ['城邦的信鸽落在吊臂上。', '「你的庇护所未经登记，', '须缴纳淡水税。——白砂」'] },
  sunken_zone: { art: ['place-01', 'npc-03'], title: '沉城', lines: ['图纸上的坐标，指向海底一座穹顶。', '灯塔叔：「那地方，', '灯照下去都会被吃掉。」'] },
  bubble_found: { art: ['npc-08', 'place-01'], title: '气泡', lines: ['管子另一头拴着个铜盔潜水员，', '打捞公司把他丢在了下面。', '「……我还能下去。我认得路。」', '气泡入住：沉城打捞 +1 钩'] },
  keycard: { art: ['npc-08', 'place-01'], title: '门禁卡', lines: ['卡上印着：深蓝计划 · 潮汐组。', '气泡：「门还通电。', '下面有人。」'] },
  octopus_night: { art: ['lore-04', 'event-04'], title: '巨型章鱼', lines: ['沉城里的东西跟着你浮了上来。', '风暴夜，触手拍打着船体。', '从今往后，风暴潮伤害 +20%。'] },
  glow: { art: ['lore-05', 'event-10'], title: '发光水母', lines: ['水母的光照亮了海底。', '远处的东西都看清了。'] },
  lab: { art: 'place-02', title: '沉没实验室', lines: ['穹顶里有一个气泡舱，', '一个老人坐在发光的屏幕前。', '「……终于有人来了。」'] },
  lin: { art: ['npc-09', 'place-02'], title: '林博士', lines: ['「深蓝计划有两部分。', '一是让人适应海洋——', '二是让海水变成免费的淡水。」'] },
  tidesong: { art: ['npc-12', 'place-02'], title: '潮生', lines: ['舱角有个人，颈侧有鳃。', '「我是第一部分。」', '「第二部分，被城邦沉进了海底。」'] },
  truth: { art: ['lore-01', 'place-02'], title: '潮汐引擎', lines: ['大淹没后，城邦拿走了档案，', '把引擎图纸封进实验室。', '免费的水，就收不到水费了。'] },
  // 第八章
  engine: { art: ['npc-09', 'story-10'], title: '潮汐引擎', lines: ['林博士：「方舟要装下引擎，', '你的庇护所必须升到最后一层。」', '铁梁：「能盖。」'] },
  ark: { art: 'story-10', title: '方舟建成', lines: ['引擎转动，海水变成了淡水，', '多到装不下。', '它已经能抵御任何风暴潮。'] },
  confront: { art: ['npc-06', 'story-02'], title: '白砂', lines: ['城邦的船停在方舟外。', '「把图纸交给联盟，', '你可以回城，免除全部欠费。」'] },
  end_broadcast: { art: ['story-09', 'story-10'], title: '广播', lines: ['每一条漂流的船都收到了图纸。', '白砂沉默了很久，', '摘下了配给官的徽章。'] },
  end_deal: { art: ['place-03', 'story-02'], title: '回城', lines: ['你住进了城邦最高的那层楼。', '水费照收。', '窗外，有人在木筏上看着你。'] },
  hook: { art: ['npc-12', 'story-10'], title: '第二阶段', lines: ['潮生：「海还在涨。」', '「深蓝计划的第二阶段，', '已经启动了。」', '—— 第一幕完 · 可继续漂流 ——'] },
};
// 结局后的被动效果（§11）
const ENDINGS = {
  broadcast: { beat: 'end_broadcast', goal: '广播结局 · 每天 #+10' },
  deal: { beat: 'end_deal', goal: '交出结局 · 不再消耗饮水' },
};
export const ENDING_CHAPTER = 8;

// 章节与目标（docs/系统设计.md §3）。目标全部完成 → 进入下一章并弹出章节卡
const CHAPTERS = [
  { title: '序章 · 漂流', goals: [['出海打捞一次', (s) => !!s.flags.sailed]] },
  { title: '第一章 · 第一口淡水', art: 'story-04', goals: [
    ['升级过滤器', (s) => s.lv.filter >= 2],
    ['救起漂流者', (s) => !!s.npc.rivet],
    ['庇护所升到 Lv2', (s) => s.lv.shelter >= 2]] },
  { title: '第二章 · 电与光', art: 'story-06', goals: [
    ['救起采样舱里的人', (s) => !!s.npc.coral],
    ['建电鳗发电机', (s) => s.lv.eel >= 1],
    ['庇护所升到 Lv3', (s) => s.lv.shelter >= 3]] },
  { title: '第三章 · 风暴季', art: 'event-04', beats: ['storm_season'], goals: [
    ['熬过一次风暴潮', (s) => !!s.flags.storm],
    ['建藤壶装甲', (s) => s.lv.armor >= 1],
    ['救起小舢板上的人', (s) => !!s.npc.pot],
    ['庇护所升到 Lv4', (s) => s.lv.shelter >= 4]] },
  { title: '第四章 · 新的邻居', art: 'story-09', enter: (s) => mark(s, 'ch4Day'), goals: [
    ['庇护所升到 Lv5', (s) => s.lv.shelter >= 5],
    ['与秤砣交易一次', (s) => !!s.flags.traded],
    ['建章鱼工坊', (s) => s.lv.octo >= 1],
    ['建寄居蟹吊机', (s) => s.lv.crab >= 1]] },
  { title: '第五章 · 远海', art: ['turtle-lv1-front', 'story-09'], enter: (s) => {
    if (!s.npc.hawk) { s.npc.hawk = true; beat(s, 'hawk_found'); beat(s, 'hawk_join'); }
  }, goals: [
    ['建海龟拖船', (s) => s.lv.turtle >= 1],
    ['进入残骸带', (s) => !!s.flags.wreck],
    [(s) => `集齐图纸碎片 ${s.flags.blueprint || 0}/${BLUEPRINTS}`, (s) => (s.flags.blueprint || 0) >= BLUEPRINTS]] },
  { title: '第六章 · 锈锚', art: ['npc-05', 'event-04'], beats: ['pirate_warn'], enter: (s) => mark(s, 'ch6Day'), goals: [
    ['建灯笼鱼信标', (s) => s.lv.lure >= 1],
    ['击退锈锚', (s) => !!s.npc.rust],
    ['庇护所升到 Lv6', (s) => s.lv.shelter >= 6]] },
  { title: '第七章 · 沉没实验室', art: ['place-01', 'story-09'], goals: [
    ['海龟拖船升到 Lv2', (s) => s.lv.turtle >= 2],
    ['救起沉城里的潜水员', (s) => !!s.npc.bubble],
    ['拿到门禁卡', (s) => !!s.flags.keycard],
    ['下潜实验室', (s) => !!s.flags.lab]] },
  { title: '第八章 · 方舟', art: 'story-10', beats: ['engine'], goals: [
    ['庇护所升到 Lv8 · 方舟', (s) => s.lv.shelter >= MAX_SHELTER],
    ['做出选择', (s) => !!s.ending]] },
  // 结局之后：自由漂流，不弹章节卡，目标行显示结局效果
  { title: '第一幕完 · 自由漂流', free: true, goals: [] },
];
// 记下进入某章的那一天（商人、海盗的节奏从这天算起）；重复调用不覆盖
function mark(s, key) { if (s.flags[key] == null) s.flags[key] = s.day; }
const goalText = (s, t) => (typeof t === 'function' ? t(s) : t);
export const CHAPTER_COUNT = CHAPTERS.length;

function storyOf(id) {
  const m = /^ch(\d+)$/.exec(id);
  if (!m) return STORY[id];
  const c = CHAPTERS[+m[1]];
  // 章节卡上的动态目标（如图纸进度）按初始状态显示
  return c && { art: c.art, title: c.title, lines: [...(c.note ? [c.note] : []), ...c.goals.map(([t]) => '· ' + goalText({ flags: {} }, t))] };
}

function beat(s, id) {
  if (!storyOf(id) || s.seen[id]) return;
  s.seen[id] = true;
  s.queue.push(id);
  flushStory(s);
}
// 没有弹窗、不在打捞中、不在撬锁中时，弹出下一个剧情
function flushStory(s) {
  const ui = s.ui;
  if (ui.overlay || ui.salvage || (ui.chest && !ui.chest.reward)) return;
  if (!s.queue.length) return;
  const id = s.queue.shift();
  if (id === 'choice') { ui.overlay = choiceOverlay(); return; }
  const st = storyOf(id);
  ui.overlay = { kind: 'story', id, title: st.title, lines: st.lines, action: '确认 · 继续' };
}
// 当前章目标全部完成时推进章节（可能连跳多章，比如老存档）
function progress(s) {
  while (s.chapter < CHAPTERS.length - 1 && CHAPTERS[s.chapter].goals.every(([, done]) => done(s))) {
    s.chapter++;
    const c = CHAPTERS[s.chapter];
    if (!c.free) beat(s, `ch${s.chapter}`);
    (c.beats || []).forEach((b) => beat(s, b));
    if (c.enter) c.enter(s);
  }
  // 商人第一次来访
  if (traderDay(s, s.day)) beat(s, 'trader');
  // 终章：第八章里庇护所到 Lv8 → 方舟建成 → 白砂 → 二选一。
  // 二选一不进 seen：存档时弹窗丢失，读档后会重新排队
  const o = s.ui.overlay;
  if (s.chapter === ENDING_CHAPTER && s.lv.shelter >= MAX_SHELTER && !s.ending
    && !s.queue.includes('choice') && !(o && o.kind === 'choice')) {
    beat(s, 'ark');
    beat(s, 'confront');
    s.queue.push('choice');
    flushStory(s);
  }
}
// 二选一弹窗：上下选、确认生效；返回键不作答（避免误触做出不可撤回的选择）
function choiceOverlay() {
  return {
    kind: 'choice', title: '你的决定',
    lines: ['图纸在你手里。', '这个选择不能撤回。'],
    options: ['向整片海广播图纸', '把图纸交给白砂'], pick: 0,
    action: '上下选择 · 确认',
  };
}
// 结局二选一：broadcast=true 广播，false 交出
export function chooseEnding(s, broadcast) {
  const o = s.ui.overlay;
  if (!o || o.kind !== 'choice') return;
  s.ending = broadcast ? 'broadcast' : 'deal';
  s.ui.overlay = null;
  s.ui.msg = broadcast ? '图纸传遍了整片海。' : '你把图纸交给了白砂。';
  beat(s, ENDINGS[s.ending].beat);
  beat(s, 'hook');
}

// ---------- 居民与剧情漂流物 ----------
const NPC = { rivet: '铆钉', coral: '珊瑚', pot: '小锅', beam: '铁梁', hawk: '灯塔叔', rust: '锈锚', bubble: '气泡' };
// 条件满足时，每次出海必定刷在最近一格（标记 !），直到救起；zone 限定海域
const DRIFT = {
  rivet: { label: '漂流集装箱', when: (s) => s.chapter >= 1 && s.day >= 2 },
  coral: { label: '漂流采样舱', when: (s) => s.chapter >= 2 },
  pot: { label: '小舢板', when: (s) => s.chapter >= 3 && !!s.flags.storm },
  bubble: { label: '断掉的气管', zone: 'sunken', when: (s) => s.chapter >= 7 },
};
// 下潜实验室：不打捞，播放剧情（林博士、潮生不入住，不喝水）
export function diveLab(s) {
  if (!s.flags.keycard || s.flags.lab) return false;
  if (!spendAp(s, AP_COST.lab, '下潜')) return false;
  s.flags.lab = true;
  ['lab', 'lin', 'tidesong', 'truth'].forEach((id) => beat(s, id));
  s.ui.screen = 'home';
  s.ui.focus = 0;
  s.ui.msg = '你带着潮汐引擎的图纸浮出了水面。';
  return true;
}
export const residents = (s) => Object.keys(s.npc).length;

// ---------- 居民：派遣与聊天（docs/交互设计.md） ----------
// 派遣：不花行动力，花口粮；居民当天不在船上，第二天早上带回 1 件（擅长海域 +1，好感 ≥3 再 +1），并入夜间结算。
// 收获只由掉落表决定；大模型（若可用）只负责把闲聊说得更像这个人，见 index.ink。
export const DISPATCH_WATER = 2; // 口粮
export const BOND_MAX = 5;
export const CREW = {
  rivet: { art: 'npc-02', zone: 'wreck', voice: 'male-qn-qingse', persona: '机械师，被城邦冤枉弄坏配给阀，嘴硬手巧，爱拆东西',
    lines: ['钉子要斜着进才咬得住。', '配给阀是自己漏的，真的。', '捞到铜线留给我。'], warn: '今晚潮大，我再钉一遍补丁。' },
  coral: { art: 'npc-04', zone: 'near', voice: 'female-tianmei', persona: '海洋生物学者，心疼被改造的电鳗，说话温和、爱记笔记',
    lines: ['电鳗今天电压很稳。', '笔记又潮了，还看得清。', '海在变，我们也在变。'], warn: '海鸟往南飞了，今晚小心。' },
  pot: { art: 'npc-07', zone: 'near', voice: 'clever_boy', persona: '被赶出后厨的年轻厨子，胆小、乐观、三句不离吃',
    lines: ['今晚海藻汤，明晚也是。', '水省着喝，汤可以淡点。', '锅底刻的日子快满了。'], warn: '锅都绑好了，晚饭照开。' },
  beam: { art: 'npc-11', zone: 'wreck', voice: 'male-qn-jingying', persona: '沉默的建筑工，话极少，只相信量过三遍的数字',
    lines: ['地基还能再加一层。', '钢梁不说谎。', '量三遍，钉一遍。'], warn: '今晚的潮，防御差一点。' },
  hawk: { art: 'npc-03', zone: 'wreck', voice: 'Chinese (Mandarin)_Radio_Host', persona: '木腿老司机，骑大海龟认路，爱讲旧世界的事',
    lines: ['这底下原来是高速公路。', '海龟比车好，不用加油。', '残骸带楼顶还没捞完。'], warn: '起浪了，海龟不肯出来。' },
  rust: { art: 'npc-05', zone: 'sunken', voice: 'female-yujie', persona: '前海盗船长，被城邦逼上黑帆，冷静、讲约定',
    lines: ['白砂的章，我也挨过。', '黑帆收了，刀还磨着。', '海上没规则，只有约定。'], warn: '今晚风大，我守夜。' },
  bubble: { art: 'npc-08', zone: 'sunken', voice: 'lovely_girl', persona: '被打捞公司丢在海底的潜水员，安静，熟悉沉城每一条路',
    lines: ['下面比上面安静。', '铜盔里能听见心跳。', '沉城的路我闭眼也认得。'], warn: '今晚别下水，它们会醒。' },
};
export const crewOf = (s) => Object.keys(CREW).filter((k) => s.npc[k]);
const bondOf = (s, k) => s.bond[k] || 0;
const addBond = (s, k) => { s.bond[k] = Math.min(BOND_MAX, bondOf(s, k) + 1); };
// 单色字形：♥ 在眼镜上会渲染成红色 emoji
const hearts = (b) => '●'.repeat(b) + '○'.repeat(BOND_MAX - b);
export const dispatchSize = (s, k, zone) => 1 + (CREW[k].zone === zone ? 1 : 0) + (bondOf(s, k) >= 3 ? 1 : 0);
const lootZones = (s) => zonesOf(s).filter((z) => ZONES[z].loot);
// 居民页的动作：每个可去的海域一行 + 聊聊
function mateMenu(s) { return [...lootZones(s), 'talk']; }

export function dispatch(s, k, zone) {
  if (!s.npc[k] || !CREW[k]) return false;
  if (s.crew[k]) { s.ui.msg = `${NPC[k]}今天已经出海了。`; return false; }
  if (!lootZones(s).includes(zone)) return false;
  if (s.res.water < DISPATCH_WATER) { s.ui.msg = `口粮不够：需要 ${SYM.water}${DISPATCH_WATER}。`; return false; }
  s.res.water -= DISPATCH_WATER;
  s.crew[k] = { zone };
  s.ui.msg = `${NPC[k]}出发去${ZONES[zone].label}了，明早回来。`;
  return true;
}

// 夜间结算时所有派遣的居民归来：派遣不会捞到剧情物；巨鲨=丢一件。返回结算行（没人出海时为空）
const DISPATCH_KINDS = new Set(['scrap', 'bottle', 'part', 'chest', 'eel', 'weed', 'letter', 'shark']);
function crewReturns(s, rng) {
  const ks = Object.keys(s.crew);
  if (!ks.length) return '';
  const got = [];
  let sharks = 0;
  for (const k of ks) {
    const { zone } = s.crew[k];
    delete s.crew[k];
    if (!CREW[k] || !ZONES[zone] || !ZONES[zone].loot) continue;
    const table = lootTable(s, zone).filter((x) => DISPATCH_KINDS.has(x.kind));
    for (let i = 0; i < dispatchSize(s, k, zone); i++) {
      const kind = pickWeighted(rng, table).kind;
      if (kind === 'shark') sharks++;
      else if (kind === 'letter') s.flags.letters = (s.flags.letters || 0) + 1;
      else if (kind !== 'weed') got.push(applyGain(s, rollLoot(s, kind, rng, zone)));
    }
    addBond(s, k);
  }
  return `派遣 ${ks.length} 人：${mergeTexts(got) || '空手'}` + (sharks ? ` · 遇鲨丢 ${sharks}` : '');
}
// 「#+3」「#+4」「≈+2」→「#+7 ≈+2」；非数值文本原样保留
function mergeTexts(list) {
  const sum = {}, other = [];
  for (const t of list) {
    const m = /^(.+)\+(\d+)$/.exec(t);
    if (m) sum[m[1]] = (sum[m[1]] || 0) + +m[2]; else if (t && !other.includes(t)) other.push(t);
  }
  return [...Object.entries(sum).map(([k, v]) => `${k}+${v}`), ...other].join(' ');
}

// 聊聊：今晚危险时先提醒，否则按次数轮换台词；每天第一次聊 +1 好感
export function talk(s, k) {
  if (!s.npc[k] || !CREW[k]) return false;
  if (s.crew[k]) { s.ui.msg = `${NPC[k]}还在海上。`; return false; }
  const c = CREW[k];
  const nd = nextDanger(s);
  const n = s.flags[`talk_${k}`] || 0;
  const line = nd && nd.in === 0 && (nd.kind === 'pirate' || nd.dmg > 0) ? c.warn : c.lines[n % c.lines.length];
  s.flags[`talk_${k}`] = n + 1;
  if (s.flags[`talked_${k}`] !== s.day) { s.flags[`talked_${k}`] = s.day; addBond(s, k); }
  s.ui.overlay = { kind: 'talk', npc: k, title: NPC[k], lines: [`「${line}」`, `好感 ${hearts(bondOf(s, k))}`], say: 0, action: '确认 · 回去干活' };
  return true;
}

// 交给大模型的提示：人设 + 当前局面 + 这次要说什么。只要台词，不让它决定任何数值
export function talkPrompt(s, o) {
  const c = CREW[o.npc];
  const nd = nextDanger(s);
  const night = !nd ? '三晚内平静' : nd.kind === 'pirate' ? `${nd.in ? nd.in + '晚后' : '今晚'}海盗` : `${nd.in ? nd.in + '晚后' : '今晚'}风暴潮`;
  const system = `你是末世漂流游戏《潮汐方舟》里的居民「${NPC[o.npc]}」：${c.persona}。` +
    '用中文、第一人称、口语，只说一句话，不超过16个字，不要旁白、不要引号、不要表情。';
  const state = `第${s.day}天，庇护所耐久${Math.round(s.hp)}，淡水${Math.floor(s.res.water)}，${night}。`;
  const ask = `船长来找你闲聊，你们的好感是${bondOf(s, o.npc)}/${BOND_MAX}。说一句符合你性格、和眼下处境有关的话。`;
  return { system, user: state + ask, voice: c.voice, fallback: o.lines[o.say] };
}
// 眼镜弹窗一行放得下的长度
export const clipLine = (t) => {
  const s = String(t).replace(/[「」"“”\n]/g, '').trim();
  return s.length > 16 ? s.slice(0, 15) + '…' : s;
};
function rescue(s, k) {
  s.npc[k] = true;
  beat(s, `${k}_found`);
  beat(s, `${k}_join`);
  return `${NPC[k]}入住`;
}

// ---------- 风暴潮（第三章起，每 3 晚一次） ----------
export const STORM_CHAPTER = 3;
export const stormNight = (s, day) => s.chapter >= STORM_CHAPTER && day % 3 === 0;
export const tideOf = (day) => Math.round(12 + 4.5 * day);
// 防御 = 12·庇护所 + 10·藤壶 + 5·铁梁 + 5·锈锚（风暴与海盗共用）
export const defense = (s) => 12 * s.lv.shelter + 10 * s.lv.armor + (s.npc.beam ? 5 : 0) + (s.npc.rust ? 5 : 0);
// 章鱼夜：沉城解锁后（拖船 Lv2），巨型章鱼跟着风暴来，风暴伤害 +20%（预报已包含）
export const octopusNight = (s) => s.lv.turtle >= 2;
export function stormDamage(s, day) {
  const base = Math.max(0, tideOf(day) - defense(s));
  return octopusNight(s) ? Math.round(base * 1.2) : base;
}
// 下一个风暴夜：{ in: 还有几晚（0=今晚）, dmg }；风暴季前返回 null
export function nextStorm(s) {
  if (s.chapter < STORM_CHAPTER) return null;
  let d = s.day;
  while (d % 3) d++;
  return { in: d - s.day, dmg: stormDamage(s, d) };
}

// ---------- 海盗夜（第六章起，风暴后一晚；击退锈锚后结束） ----------
export const PIRATE_CHAPTER = 6;
export function pirateNight(s, day) {
  if (s.chapter < PIRATE_CHAPTER || s.npc.rust || s.flags.ch6Day == null) return false;
  return day % 3 === 1 && day >= s.flags.ch6Day + 2; // 至少给两天准备
}
// 战力 30 + 3·天；每交一次保护费，下次 +10%
export const PIRATE_CAP = 100; // 第六章庇护所 Lv6 + 藤壶 Lv3 + 铁梁 = 107 就能打赢，保证不会卡关
export const pirateForce = (s, day) => Math.min(PIRATE_CAP, Math.round((30 + 3 * day) * Math.pow(1.1, s.flags.paid || 0)));
// 下一个危险夜（风暴或海盗），最多看 3 晚
export function nextDanger(s) {
  for (let d = s.day; d < s.day + 3; d++) {
    if (pirateNight(s, d)) { const force = pirateForce(s, d); return { kind: 'pirate', in: d - s.day, force, win: defense(s) >= force }; }
    if (stormNight(s, d)) return { kind: 'storm', in: d - s.day, dmg: stormDamage(s, d) };
  }
  return null;
}

// ---------- 商人秤砣（第四章开始后的第 2 天起，每 3 天来一次，当天有效） ----------
export const TRADER_CHAPTER = 4;
export function traderDay(s, day) {
  const start = s.flags.ch4Day;
  return s.chapter >= TRADER_CHAPTER && start != null && day > start && (day - start - 1) % 3 === 0;
}
const TRADES = [
  { give: { scrap: 15 }, get: { parts: 1 } },
  { give: { scrap: 25 }, get: { eels: 1 } },
  { give: { water: 10 }, get: { scrap: 12 } },
  { give: { parts: 2 }, get: { water: 15 } },
  { give: { scrap: 40 }, get: { chest: 'iron' } },
];
// 每次来访 3 个交易，按天轮换（确定性，存档无需保存货单）
export const tradesOf = (s) => [0, 1, 2].map((i) => (s.day + i) % TRADES.length);
const tradeUsed = (s, i) => !!(s.trade && s.trade.day === s.day && s.trade.used[i]);

// 从子界面返回时，主界面焦点回到对应项
const SCREEN_ITEM = { build: 'build', chests: 'chests', trade: 'trader', zones: 'salvage', crew: 'crew' };
function homeMenu(s) {
  const list = ['salvage', 'build', 'chests'];
  if (residents(s) > 0) list.push('crew');
  if (s.hp < HP_MAX) list.push('repair');
  if (traderDay(s, s.day)) list.push('trader');
  list.push('rest');
  return list;
}
// 建造列表只显示已解锁的设施，按解锁顺序
const UNLOCK = { eel: 2, armor: STORM_CHAPTER, octo: 4, crab: 4, turtle: 5, lure: 6 };
function buildMenu(s) {
  const list = ['shelter', 'filter'];
  for (const [k, ch] of Object.entries(UNLOCK)) {
    if (s.chapter >= ch || s.lv[k] > 0 || (k === 'eel' && s.res.eels > 0)) list.push(k);
  }
  return list;
}
export const MAX_ARMOR = 3;
const MAX_LV = { armor: 3, octo: 3, crab: 3, turtle: 2, lure: 3 };
export const BUILD_ROWS = 4; // 建造列表一屏最多 4 行，超出滚动

// ---------- art ----------
// ART 由 tools/art/to-green.mjs 生成；缺图时 art() 返回 ''，模板退回字符画。
// 路径相对于 pages/index/index.ink。
const ART_BASE = '../../assets/art/';
const ART_SET = new Set(ART);
const LOOT_ART = { scrap: 'salvage-04', bottle: 'salvage-07', part: 'salvage-01', chest: 'chest-wood-closed', eel: 'char-24', weed: 'salvage-08', blueprint: 'lore-02', shark: 'lore-03', jelly: 'lore-05', letter: 'salvage-18' };
const HOME_ART = { salvage: 'icon-08', build: 'icon-06', chests: 'icon-10', repair: 'icon-07', trader: 'npc-10', crew: 'npc-02', rest: ['event-10', 'story-01'] };
const ZONE_ART = { near: 'icon-08', wreck: ['place-03', 'turtle-lv1-front'], sunken: ['place-01', 'turtle-lv2-front'], lab: ['place-02', 'place-01'] };
function overlayArt(o) {
  if (o.kind === 'choice') return art(['npc-06', 'lore-01', 'story-10']);
  if (o.kind === 'raid') return art(['npc-05', 'place-04', 'event-04']);
  if (o.kind === 'over') return art('story-07');
  if (o.kind === 'talk') return art(CREW[o.npc].art);
  if (o.kind === 'story') return art(storyOf(o.id).art);
  return art(o.storm ? 'event-04' : 'event-10');
}
function art(ids) {
  for (const id of [].concat(ids || [])) if (ART_SET.has(id)) return ART_BASE + id + '.png';
  return '';
}
const ART_PREFIX = { shelter: 'shelter', filter: 'filter', eel: 'eel', armor: 'barnacle', octo: 'octo', crab: 'crab', turtle: 'turtle', lure: 'lure' };
// 某类素材只画到 maxLv 级，更高等级沿用最高一张
function levelArt(prefix, lv) {
  for (let l = Math.max(1, lv); l >= 1; l--) { const p = art(`${prefix}-lv${l}-front`); if (p) return p; }
  return '';
}

// ---------- helpers ----------
const randInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function pickWeighted(rng, list) {
  const total = list.reduce((s, x) => s + x.w, 0);
  let r = rng() * total;
  for (const x of list) { r -= x.w; if (r < 0) return x; }
  return list[list.length - 1];
}

export function caps(s) {
  return { water: 20 + 10 * s.lv.shelter, power: 10 + 10 * s.lv.eel };
}
// 每晚的产出（夜间结算时发生）：电鳗发电 → 过滤器耗电造水。
// 电不够时按比例减产，最低 30%（不用电也能靠日晒蒸馏一点）
export const NIGHT = { water: 6, power: 12, filterNeed: 5, octoNeed: 3 };
export function rates(s) {
  const gen = Math.round(NIGHT.power * s.lv.eel * (s.npc.coral ? 1.2 : 1));
  const need = NIGHT.filterNeed * s.lv.filter + NIGHT.octoNeed * s.lv.octo; // 章鱼工坊也耗电
  const full = NIGHT.water * s.lv.filter;
  return { gen, need, full };
}
// 今晚的实际产出：{ powerUse, water, ratio }
function tonight(s, r = rates(s)) {
  const have = Math.min(caps(s).power, s.res.power + r.gen);
  const ratio = r.need ? Math.max(0.3, Math.min(1, have / r.need)) : 1;
  return { have, powerUse: Math.min(have, r.need), water: Math.floor(r.full * ratio), ratio };
}

// ---------- state ----------
export function newGame() {
  return {
    v: SAVE_VERSION,
    day: 1,
    ap: AP_MAX, // 今天剩余行动力
    hp: HP_MAX,
    res: { scrap: 8, water: 10, power: 0, parts: 0, eels: 0 },
    lv: { shelter: 1, filter: 1, eel: 0, armor: 0, octo: 0, crab: 0, turtle: 0, lure: 0 },
    chapter: 0,
    npc: {}, // 已入住居民
    flags: {}, // sailed / storm 等一次性进度
    chests: [],
    over: false,
    ending: null, // 'broadcast' | 'deal'：结局后进入自由模式
    seen: {}, // 已触发的剧情节点
    queue: [], // 待弹出的剧情节点
    crew: {}, // 今天出海的居民 { k: { zone } }，夜间结算时归来
    bond: {}, // 居民好感 0–5
    checkpoint: null, // 今天早上的存档：沉没后可以从这里重来
    ui: freshUi('漂流第一天。先出海打捞些废料吧。'),
  };
}

function freshUi(msg = '') {
  return { screen: 'home', focus: 0, msg, salvage: null, chest: null, overlay: null, report: null };
}

export function serialize(s) {
  const { ui, ...rest } = s;
  return rest;
}
export function restore(saved) {
  if (!saved || !(saved.v >= 1 && saved.v <= SAVE_VERSION) || !saved.res || !saved.lv) {
    // 第一次游玩：播放序章
    const s = newGame();
    ['prologue1', 'prologue2', 'prologue3'].forEach((id) => beat(s, id));
    return s;
  }
  const fresh = newGame();
  const s = {
    ...fresh, ...saved,
    lv: { ...fresh.lv, ...saved.lv },
    npc: { ...saved.npc }, flags: { ...saved.flags }, seen: { ...saved.seen }, queue: [...(saved.queue || [])],
    crew: { ...saved.crew }, bond: { ...saved.bond },
  };
  if (saved.chapter == null) migrateV01(s);
  s.v = SAVE_VERSION;
  delete s.won; delete s.arkSeen; // v1 的方舟弹窗标记，结局改由 s.ending 记录
  // v2 是实时制：没有行动力，派遣按秒倒计时、归来汇报单独弹窗
  delete s.clock; delete s.cooldown; delete s.returns;
  if (!(s.ap >= 0 && s.ap <= AP_MAX)) s.ap = AP_MAX;
  for (const k of Object.keys(s.crew)) s.crew[k] = { zone: s.crew[k].zone || 'near' };
  // 补上已进入章节的一次性设置（存档早于该章节实现时）
  for (let i = 1; i <= s.chapter; i++) if (CHAPTERS[i] && CHAPTERS[i].enter) CHAPTERS[i].enter(s);
  s.ui = freshUi(`欢迎回来。第 ${s.day} 天。`);
  if (s.over) s.ui.overlay = gameOverOverlay(s);
  else { progress(s); flushStory(s); }
  return s;
}

// v0.1 存档（没有章节）：按等级推断章节（§13），补上之前章节的居民，已经过的剧情不重放
function migrateV01(s) {
  const lv = s.lv;
  const ch = lv.shelter >= 4 ? 4 : lv.shelter >= 3 ? 3 : lv.shelter >= 2 || lv.eel > 0 ? 2 : 1;
  s.chapter = ch;
  const seen = ['prologue1', 'prologue2', 'prologue3'];
  for (let i = 0; i <= ch; i++) seen.push(`ch${i}`);
  const join = (k) => { s.npc[k] = true; seen.push(`${k}_found`, `${k}_join`); };
  if (ch >= 2) join('rivet');
  if (ch >= 3) { join('coral'); seen.push('storm_season'); }
  if (ch >= 4) { join('pot'); s.flags.storm = true; seen.push('storm'); }
  if (lv.shelter >= 5) { join('beam'); seen.push('outpost'); }
  if (lv.filter >= 2) seen.push('part', 'filter');
  if (lv.eel >= 1) seen.push('eel', 'power');
  seen.forEach((id) => { s.seen[id] = true; });
}

// ---------- costs ----------
export function costOf(s, what) {
  const cost = baseCost(s, what);
  // 铆钉：建造废料 −10%（向上取整）
  if (s.npc.rivet && cost.scrap) cost.scrap = Math.ceil(cost.scrap * 0.9);
  return cost;
}
function baseCost(s, what) {
  const lv = s.lv;
  if (what === 'armor') {
    if (s.chapter < STORM_CHAPTER && lv.armor === 0) return { locked: '风暴季解锁' };
    if (lv.armor >= MAX_ARMOR) return { max: true };
    return { scrap: 15 + 15 * lv.armor, parts: 1 };
  }
  if (what in UNLOCK && what !== 'eel' && what !== 'armor') {
    if (s.chapter < UNLOCK[what] && lv[what] === 0) return { locked: `第${'零一二三四五六七八'[UNLOCK[what]]}章解锁` };
    if (lv[what] >= MAX_LV[what]) return { max: true };
    const L = lv[what];
    if (what === 'octo') return { scrap: 20 + 15 * L, eels: 1 };
    if (what === 'crab') return { scrap: 18 + 12 * L };
    if (what === 'lure') return { scrap: 25 + 20 * L, eels: 1 };
    if (what === 'turtle') {
      if (L === 0) return { scrap: 40, water: 10 };
      if (s.chapter < 7) return { locked: '沉城 · 第七章' };
      return { scrap: 90, water: 20, parts: 3 };
    }
  }
  if (what === 'shelter') {
    if (lv.shelter >= MAX_SHELTER) return { max: true };
    // 方舟要装潮汐引擎：第八章才能盖最后一层
    if (lv.shelter + 1 === MAX_SHELTER && s.chapter < ENDING_CHAPTER) return { locked: '方舟 · 第八章' };
    const cost = { scrap: SHELTER_SCRAP[lv.shelter - 1], water: SHELTER_WATER[lv.shelter - 1] };
    if (lv.shelter + 1 === MAX_SHELTER) cost.parts = ARK_PARTS;
    return cost;
  }
  if (what === 'filter') {
    if (lv.filter >= lv.shelter + 1) return { locked: `需庇护所 Lv${lv.filter}` };
    return { scrap: 6 + 4 * lv.filter, parts: lv.filter };
  }
  if (what === 'eel') {
    if (lv.shelter < 2) return { locked: '需庇护所 Lv2' };
    if (lv.eel >= lv.shelter) return { locked: `需庇护所 Lv${lv.eel + 1}` };
    return { scrap: 10 + 8 * lv.eel, eels: 1 };
  }
  return { locked: '?' };
}
function affordable(s, cost) {
  if (cost.max || cost.locked) return false;
  return Object.entries(cost).every(([k, v]) => s.res[k] >= v);
}
function pay(s, cost) {
  for (const [k, v] of Object.entries(cost)) s.res[k] -= v;
}
function costText(cost) {
  if (cost.max) return '已满级';
  if (cost.locked) return cost.locked;
  return Object.entries(cost).map(([k, v]) => `${SYM[k]}${v}`).join(' ');
}

export function upgrade(s, what) {
  const cost = costOf(s, what);
  if (!affordable(s, cost)) {
    s.ui.msg = cost.max ? '已经满级。' : cost.locked ? cost.locked + '。' : '材料不足。';
    return false;
  }
  if (!spendAp(s, AP_COST.build, '建造')) return false;
  pay(s, cost);
  s.lv[what]++;
  if (what === 'shelter') {
    s.hp = HP_MAX;
    const era = eraOf(s.lv.shelter);
    s.ui.msg = `庇护所升至 Lv${s.lv.shelter}，耐久回满。` + (era !== eraOf(s.lv.shelter - 1) ? `进入${era}。` : '');
    if (s.lv.shelter === 5) {
      beat(s, 'outpost');
      s.npc.beam = true; // 铁梁随新邻居一起来
      beat(s, 'beam_join');
    }
    if (s.lv.shelter === 7) beat(s, 'industry');
    // Lv8：方舟建成与结局由 progress() 接着排队
  } else if (what === 'filter') {
    s.ui.msg = `过滤器升至 Lv${s.lv.filter}。`;
    beat(s, 'filter');
  } else if (what === 'armor') {
    s.ui.msg = `藤壶装甲 Lv${s.lv.armor}，风暴防御 ${defense(s)}。`;
    beat(s, 'armor');
  } else if (what === 'octo') {
    s.ui.msg = `章鱼工坊 Lv${s.lv.octo}：每晚最多 ${s.lv.octo} 次 ${SYM.scrap}8→${SYM.parts}1。`;
    beat(s, 'octo');
  } else if (what === 'crab') {
    s.ui.msg = `寄居蟹吊机 Lv${s.lv.crab}：每晚 ${SYM.scrap}+${3 * s.lv.crab}。`;
    beat(s, 'crab');
  } else if (what === 'turtle') {
    s.ui.msg = `海龟拖船 Lv${s.lv.turtle}：可以去${s.lv.turtle >= 2 ? '沉城' : '残骸带'}了。`;
    beat(s, s.lv.turtle >= 2 ? 'sunken_zone' : 'turtle');
  } else if (what === 'lure') {
    s.ui.msg = `灯笼鱼信标 Lv${s.lv.lure}：准星 −${10 * s.lv.lure}%。`;
    beat(s, 'lure');
  } else {
    s.ui.msg = `安置了一条电鳗，发电机 Lv${s.lv.eel}。`;
    beat(s, 'power');
  }
  return true;
}

export function repair(s) {
  if (s.hp >= HP_MAX) { s.ui.msg = '耐久已满。'; return false; }
  if (s.res.scrap < REPAIR_COST) { s.ui.msg = '废料不足，无法修补。'; return false; }
  if (!spendAp(s, AP_COST.repair, '修补')) return false;
  s.res.scrap -= REPAIR_COST;
  s.hp = Math.min(HP_MAX, s.hp + REPAIR_HP);
  s.ui.msg = `修补完成，耐久 ${Math.round(s.hp)}。`;
  return true;
}

// ---------- 行动力 ----------
// 够就扣掉并返回 true；不够时写提示并返回 false
export function spendAp(s, n, what = '') {
  if (s.ap < n) {
    s.ui.msg = `行动力不够${what ? '去' + what : ''}（需要 ${n}，剩 ${s.ap}）。结束今天就能恢复。`;
    return false;
  }
  s.ap -= n;
  return true;
}

export function endDay(s, rng = Math.random) {
  const day = s.day;
  const r = rates(s);
  // 1. 饮水：基础 + 天数 + 每位居民 1 份（小锅抵 1）。交出结局：城邦供水，不再消耗饮水
  const consume = s.ending === 'deal' ? 0 : Math.max(0, 3 + Math.floor(day / 4) + residents(s) - (s.npc.pot ? 1 : 0));
  let short = 0;
  if (s.res.water >= consume) s.res.water -= consume;
  else { short = Math.ceil(consume - s.res.water); s.res.water = 0; }
  const thirst = short * THIRST_HP;
  const stormy = stormNight(s, day);
  const storm = stormy ? stormDamage(s, day) : 0;
  // 结局后的自由模式：不会沉没，耐久最低 1
  s.hp = Math.max(s.ending ? 1 : 0, s.hp - thirst - storm);
  // 结束一天时退出打捞/开箱，避免弹窗叠在小游戏上
  if (s.ui.salvage) finishSalvage(s, true);
  s.ui.chest = null;
  if (s.hp <= 0) {
    s.over = true;
    s.ui.screen = 'home';
    s.ui.overlay = gameOverOverlay(s);
    return;
  }
  // 2. 夜间产出：发电 → 造水（喝过之后才产出，白天花掉的水今晚补不回来）
  const t = tonight(s, r);
  s.res.power = t.have - t.powerUse;
  const made = addWater(s, t.water);
  const powered = t.ratio >= 1;
  s.day = day + 1;
  s.ap = AP_MAX;
  // 商人只待一天；海域选择也收起
  s.ui.screen = 'home';
  s.ui.focus = 0;
  s.ui.msg = `第 ${s.day} 天早上，行动力补满了。`;
  if (stormy) s.flags.storm = true;
  const lines = [`饮水 ${SYM.water}-${consume}` + (short ? ` 缺 ${short}（-${thirst}）` : '') + `  夜里造水 ${SYM.water}+${made}` + (powered ? '' : ` 缺电${Math.round(t.ratio * 100)}%`)];
  const work = nightWork(s);
  if (work) lines.push(work);
  const back = crewReturns(s, rng);
  if (back) lines.push(back);
  const raid = pirateNight(s, day);
  if (raid) lines.push('黑帆靠近了……');
  else if (!stormy) lines.push('平静的一夜');
  else {
    const name = octopusNight(s) ? '风暴潮+章鱼' : '风暴潮';
    lines.push(storm ? `${name} -${storm}（潮 ${tideOf(day)} / 防 ${defense(s)}）` : `${name}被挡住了（防 ${defense(s)}）`);
  }
  const report = { kind: 'report', storm: storm > 0, title: `第 ${day} 天结束`, lines, action: '确认 · 迎接新一天' };
  if (raid) {
    // 海盗夜：先二选一，结果写进结算弹窗再显示
    const force = pirateForce(s, day);
    s.ui.report = report;
    s.ui.overlay = {
      kind: 'raid', title: '锈锚', force,
      lines: ['「交出一半废料，或者打一场。」', `战力 ${force} · 我方防御 ${defense(s)}`],
      options: [defense(s) >= force ? '打（能赢）' : '打（会输：耐久-20 废料-30%）', '交保护费（废料-50%）'], pick: defense(s) >= force ? 0 : 1,
      action: '上下选择 · 确认',
    };
    return;
  }
  finishReport(s, report);
  if (stormy) beat(s, 'storm'); // 排在结算弹窗之后
  if (stormy && octopusNight(s)) beat(s, 'octopus_night');
}
export const THIRST_HP = 6;
function finishReport(s, report) {
  report.lines.push(`剩余耐久 ${Math.round(s.hp)}/${HP_MAX}`);
  const nd = nextDanger(s);
  if (nd && nd.in === 0) {
    if (nd.kind === 'storm') report.lines.push(nd.dmg ? `警告：今晚风暴潮 -${nd.dmg}` : '今晚风暴潮，挡得住');
    else report.lines.push(`警告：今晚海盗，战力 ${nd.force}`);
  }
  // 弹窗最多 6 行：合并多余的行
  while (report.lines.length > 6) report.lines.splice(1, 2, report.lines[1] + '  ' + report.lines[2]);
  s.ui.overlay = report;
  progress(s);
  // 新一天的早上：记下重来点（不含 ui 和旧的重来点）
  const { ui, checkpoint, ...rest } = s;
  s.checkpoint = JSON.parse(JSON.stringify(rest));
}
// 被动产出：寄居蟹吊机、章鱼工坊。返回结算行（没有产出时为空）
function nightWork(s) {
  const out = [];
  if (s.lv.crab) { const n = 3 * s.lv.crab; s.res.scrap += n; out.push(`吊机 ${SYM.scrap}+${n}`); }
  let k = 0;
  for (let i = 0; i < s.lv.octo && s.res.scrap >= 8; i++) { s.res.scrap -= 8; s.res.parts++; k++; }
  if (s.lv.octo) out.push(`工坊 ${SYM.parts}+${k}`);
  // 广播结局：漂流者每天送来废料
  if (s.ending === 'broadcast') { s.res.scrap += 10; out.push(`漂流者 ${SYM.scrap}+10`); }
  return out.join('  ');
}
// 海盗二选一：fight=true 打，false 交
export function resolveRaid(s, fight) {
  const o = s.ui.overlay;
  if (!o || o.kind !== 'raid') return;
  const report = s.ui.report;
  s.ui.report = null;
  // 弹窗仍是海盗弹窗：期间触发的剧情只排队，排在结算弹窗之后
  let line;
  const def = defense(s);
  if (fight && def >= o.force) {
    s.npc.rust = true;
    line = `击退海盗！（防 ${def} ≥ 战力 ${o.force}）`;
    beat(s, 'raid_win');
    beat(s, 'rust_talk');
  } else if (fight) {
    const lost = Math.floor(s.res.scrap * 0.3);
    s.res.scrap -= lost;
    s.hp = Math.max(0, s.hp - 20);
    line = `败了：耐久 -20  ${SYM.scrap}-${lost}`;
  } else {
    const lost = Math.floor(s.res.scrap * 0.5);
    s.res.scrap -= lost;
    s.flags.paid = (s.flags.paid || 0) + 1;
    line = `交了保护费 ${SYM.scrap}-${lost}`;
  }
  if (s.hp <= 0) { s.over = true; s.ui.overlay = gameOverOverlay(s); return; }
  report.lines.splice(report.lines.length - 1, 1, line);
  finishReport(s, report);
}

// ---------- 商人 ----------
export function trade(s, i) {
  const t = TRADES[tradesOf(s)[i]];
  if (!traderDay(s, s.day) || !t) return false;
  if (tradeUsed(s, i)) { s.ui.msg = '这笔今天已经换过了。'; return false; }
  if (!affordable(s, t.give)) { s.ui.msg = '秤砣：「不够。我不赊账。」'; return false; }
  pay(s, t.give);
  if (t.get.chest) s.chests.push(t.get.chest);
  else for (const [k, v] of Object.entries(t.get)) { if (k === 'water') addWater(s, v); else s.res[k] += v; }
  if (!s.trade || s.trade.day !== s.day) s.trade = { day: s.day, used: [] };
  s.trade.used[i] = true;
  s.flags.traded = true;
  s.ui.msg = `成交：${costText(t.give)} → ${tradeGetText(t)}`;
  return true;
}
const tradeGetText = (t) => (t.get.chest ? `${CHEST[t.get.chest].label}1` : costText(t.get));

// 沉没：默认从当天早上重来（存档里的重来点），也可以从头开始；返回键不作答
function gameOverOverlay(s) {
  const cp = s.checkpoint;
  return {
    kind: 'over',
    title: '庇护所沉没',
    lines: [`你坚持到了第 ${s.day} 天。`, `庇护所最高 Lv${s.lv.shelter}。`],
    options: cp ? [`从第 ${cp.day} 天早上重来`, '从头开始'] : ['从头开始'],
    pick: 0,
    action: '上下选择 · 确认',
  };
}
// 沉没后重来：retry=true 回到重来点（保留重来点，可以再试），否则清档从序章开始
export function restart(s, retry) {
  const cp = s.checkpoint;
  const next = retry && cp ? restore(JSON.parse(JSON.stringify(cp))) : restore(null);
  if (retry && cp) { next.checkpoint = cp; next.ui.msg = `回到第 ${next.day} 天早上。这次换个做法？`; }
  Object.keys(s).forEach((k) => delete s[k]);
  Object.assign(s, next);
}

// ---------- salvage：选目标 + 见好就收 ----------
// 海面 5 件东西，由近到远。近处 2 件看得清、必中；远处是「？」，成功率更低，但稀有物更多，也可能是巨鲨。
// 上下选一件、确认落钩，不需要卡时机。普通收获返航时才入库：碰上巨鲨会扯断钩子并叼走本趟一半收获。
// 剧情物（漂流者、图纸、门禁卡）总在近处，钩中立即生效，巨鲨叼不走。
export const SLOT_ODDS = [1, 0.9, 0.75, 0.6, 0.45];
export const NEAR_SLOTS = 2;
const FAR_ONLY = new Set(['shark', 'jelly']);
const STORY_KINDS = new Set(['drift', 'blueprint', 'keycard']);
// 图纸碎片还需要时才会出现
const needBlueprint = (s) => s.chapter >= 5 && (s.flags.blueprint || 0) < BLUEPRINTS;
// 当前海域的掉落表：灯笼鱼信标每级让稀有物权重 +20%
function lootTable(s, zone) {
  const boost = 1 + 0.2 * s.lv.lure;
  return ZONES[zone].loot
    .filter((x) => (x.kind !== 'blueprint' || needBlueprint(s)) && (x.kind !== 'keycard' || needKeycard(s)))
    .map((x) => (RARE.has(x.kind) ? { ...x, w: x.w * boost } : x));
}
// 远处成功率：信标每级 +5%，灯塔叔在残骸带 +5%
function slotOdds(s, zone, i) {
  if (i < NEAR_SLOTS) return SLOT_ODDS[i];
  const bonus = 0.05 * s.lv.lure + (zone === 'wreck' && s.npc.hawk ? 0.05 : 0);
  return Math.min(0.95, SLOT_ODDS[i] + bonus);
}
// 剧情物以外的掉落：近处没有巨鲨和水母；越远稀有物越多
function slotTable(s, zone, i) {
  const far = 1 + 0.25 * i;
  return lootTable(s, zone)
    .filter((x) => !STORY_KINDS.has(x.kind) && (i >= NEAR_SLOTS || !FAR_ONLY.has(x.kind)))
    .map((x) => (RARE.has(x.kind) ? { ...x, w: x.w * far } : x));
}
export const KEY_CHANCE = 0.35; // 还缺剧情物时每趟出现的概率；第 3 趟起必出

export function startSalvage(s, rng = Math.random, zone = 'near') {
  const Z = ZONES[zone] && ZONES[zone].loot ? ZONES[zone] : ZONES.near;
  zone = ZONES[zone] === Z ? zone : 'near';
  if (!spendAp(s, AP_COST[zone], Z.label)) return false;
  const items = [];
  for (let i = 0; i < 5; i++) {
    const loot = pickWeighted(rng, slotTable(s, zone, i));
    items.push({ kind: loot.kind, label: loot.label, tag: loot.tag });
  }
  // 剧情物放在最近的格子里
  const special = [];
  if (zone === 'wreck') { s.flags.wreck = true; beat(s, 'wreck_zone'); }
  const key = KEY_ITEM[zone];
  if (key) {
    s.flags[key.trips] = (s.flags[key.trips] || 0) + 1;
    if (key.need(s) && (s.flags[key.trips] >= 3 || rng() < KEY_CHANCE)) special.push({ kind: key.kind, label: key.label, tag: '!' });
  }
  const who = Object.keys(DRIFT).find((k) => !s.npc[k] && DRIFT[k].when(s) && (!DRIFT[k].zone || DRIFT[k].zone === zone));
  if (who) special.unshift({ kind: 'drift', npc: who, label: DRIFT[who].label, tag: '!' });
  special.forEach((it, i) => { items[i] = it; });
  const list = items.map((it, i) => ({
    ...it, id: i,
    odds: STORY_KINDS.has(it.kind) ? 1 : slotOdds(s, zone, i),
    hidden: i >= NEAR_SLOTS && !STORY_KINDS.has(it.kind),
    caught: false, missed: false,
  }));
  // 气泡认路：沉城多 1 钩
  const hooks = HOOKS_PER_TRIP + (zone === 'sunken' && s.npc.bubble ? 1 : 0);
  s.flags.sailed = true;
  s.ui.screen = 'salvage';
  s.ui.focus = 0;
  s.ui.salvage = { zone, items: list, hooks, max: hooks, used: 0, last: '选一件，确认落钩', pending: [], haul: [], done: false };
  return true;
}

// 打捞界面的焦点：0..4 是海面上的东西，5 是「返航」；跳过已经钩过的
export const salvageReturnIdx = (sv) => sv.items.length;
function salvageMove(s, dir) {
  const sv = s.ui.salvage;
  const n = sv.items.length + 1;
  let f = s.ui.focus;
  for (let k = 0; k < n; k++) {
    f = (f + dir + n) % n;
    if (f === n - 1 || !sv.items[f].caught) break;
  }
  s.ui.focus = f;
}

export function dropHook(s, rng = Math.random, idx = s.ui.focus) {
  const sv = s.ui.salvage;
  if (!sv || sv.done) return null;
  const it = sv.items[idx];
  if (!it || it.caught) return null;
  sv.hooks--;
  sv.used++;
  it.caught = true;
  const was = it.hidden;
  it.hidden = false;
  if (it.kind === 'shark') {
    // 巨鲨：多扯断一钩、耐久 −5、叼走本趟一半（向上取整）还没入库的收获
    sv.hooks = Math.max(0, sv.hooks - 1);
    s.hp = Math.max(1, s.hp - 5);
    const lost = Math.ceil(sv.pending.length / 2);
    for (let i = 0; i < lost; i++) sv.pending.splice(Math.floor(rng() * sv.pending.length), 1);
    sv.last = '巨鲨！扯断一钩，耐久 -5' + (lost ? `，叼走 ${lost} 件` : '');
    beat(s, 'shark');
  } else if (it.odds < 1 && rng() >= it.odds) {
    it.missed = true;
    sv.last = `${was ? '那东西' : it.label}脱钩沉下去了`;
  } else if (it.kind === 'jelly') {
    // 发光水母：照亮海面，剩下的「？」都看清了
    sv.items.forEach((x) => { x.hidden = false; });
    sv.last = '发光水母照亮了海面';
    beat(s, 'glow');
  } else if (it.kind === 'letter') {
    // 漂流瓶：消息栏显示瓶中的话，返航汇总只记「漂流瓶」
    const n = s.flags.letters || 0;
    s.flags.letters = n + 1;
    sv.last = `漂流瓶：「${LETTERS[n % LETTERS.length]}」`;
    sv.haul.push('漂流瓶');
  } else if (STORY_KINDS.has(it.kind)) {
    const text = it.kind === 'drift' ? rescue(s, it.npc) : storyLoot(s, it.kind);
    sv.last = `捞到${it.label}：${text}`;
    sv.haul.push(text);
  } else {
    const g = rollLoot(s, it.kind, rng, sv.zone);
    sv.pending.push(g);
    sv.last = `捞到${it.label}：${g.text}`;
  }
  if (sv.hooks <= 0) {
    sv.done = true;
    sv.last += '。钩索用完';
    s.ui.focus = salvageReturnIdx(sv);
  } else if (sv.items[s.ui.focus] && sv.items[s.ui.focus].caught) {
    salvageMove(s, 1);
  }
  return it.missed ? null : it.kind;
}

function addWater(s, n) {
  const before = s.res.water;
  s.res.water = Math.min(caps(s).water, s.res.water + n);
  return Math.round(s.res.water - before);
}

// 普通掉落：先掷出数量（返航时才入库）。{ res, chest, text, beat }
function rollLoot(s, kind, rng, zone = 'near') {
  switch (kind) {
    case 'scrap': {
      // 远海的废料块更大：残骸带 +3，沉城 +5
      const n = randInt(rng, 3, 5) + Math.floor(s.day / 3) + ({ wreck: 3, sunken: 5 }[zone] || 0);
      return { res: { scrap: n }, text: `${SYM.scrap}+${n}` };
    }
    case 'bottle': {
      const n = randInt(rng, 2, 4);
      return { res: { water: n }, text: `${SYM.water}+${n}` };
    }
    case 'part': return { res: { parts: 1 }, text: `${SYM.parts}+1`, beat: 'part' };
    case 'eel': return { res: { eels: 1 }, text: `${SYM.eels}+1`, beat: 'eel' };
    case 'chest': {
      const r = rng();
      // 沉城只有铁箱和金箱
      const k = zone === 'sunken' ? (r < 0.75 ? 'iron' : 'gold') : r < 0.7 ? 'wood' : r < 0.95 ? 'iron' : 'gold';
      return { chest: k, text: `${CHEST[k].label}+1` };
    }
    default:
      return { text: '一团海藻' };
  }
}
// 入库，返回实际到手的文本（淡水可能被上限截掉）
function applyGain(s, g) {
  if (g.chest) s.chests.push(g.chest);
  let text = g.text;
  for (const [k, v] of Object.entries(g.res || {})) {
    if (k === 'water') { const n = addWater(s, v); text = n > 0 ? `${SYM.water}+${n}` : '淡水已满'; }
    else s.res[k] += v;
  }
  if (g.beat) beat(s, g.beat);
  return text;
}
function storyLoot(s, kind) {
  if (kind === 'blueprint') {
    if (!needBlueprint(s)) return '一张烂纸';
    const n = (s.flags.blueprint || 0) + 1;
    s.flags.blueprint = n;
    beat(s, `blueprint${n}`);
    return `图纸 ${n}/${BLUEPRINTS}`;
  }
  if (!needKeycard(s)) return '一张旧卡片';
  s.flags.keycard = true;
  beat(s, 'keycard');
  return '门禁卡';
}

export function finishSalvage(s, silent = false) {
  const sv = s.ui.salvage;
  if (!sv) return;
  // 先清掉打捞界面，入库时触发的剧情（第一枚滤芯等）才能弹出
  s.ui.salvage = null;
  s.ui.screen = 'home';
  s.ui.focus = 0;
  const got = sv.pending.map((g) => applyGain(s, g)).filter((t) => t !== '一团海藻');
  const all = [mergeTexts(got), ...sv.haul].filter(Boolean);
  if (!silent) s.ui.msg = all.length ? `返航：${all.join('  ')}` : '这趟空手而归。';
  flushStory(s);
}

// ---------- chests ----------
export function rollChest(s, kind, rng = Math.random) {
  const out = [];
  const give = (k, n) => {
    if (n <= 0) return;
    if (k === 'water') { n = addWater(s, n); if (n <= 0) return; }
    else s.res[k] += n;
    out.push(`${SYM[k]}+${n}`);
  };
  if (kind === 'wood') {
    give('scrap', randInt(rng, 4, 8));
    if (rng() < 0.4) give('water', randInt(rng, 3, 5));
    if (rng() < 0.25) give('parts', 1);
  } else if (kind === 'iron') {
    give('scrap', randInt(rng, 8, 14));
    give('parts', randInt(rng, 1, 2));
    if (rng() < 0.3) give('eels', 1);
  } else {
    give('scrap', randInt(rng, 15, 25));
    give('parts', randInt(rng, 2, 3));
    give('eels', 1);
  }
  return out.join('  ') || '空箱';
}

// 开箱：确认一次就开（花 1 行动力），再确认收下
function chestPress(s, rng) {
  const ui = s.ui;
  if (ui.chest) { ui.chest = null; ui.focus = clamp(ui.focus, 0, Math.max(0, s.chests.length - 1)); return; }
  if (!s.chests.length) { ui.msg = '没有宝箱。出海打捞看看？'; return; }
  const idx = clamp(ui.focus, 0, s.chests.length - 1);
  if (!spendAp(s, AP_COST.chest, '开箱')) return;
  const kind = s.chests.splice(idx, 1)[0];
  const reward = rollChest(s, kind, rng);
  ui.chest = { kind, reward };
  ui.msg = `${CHEST[kind].label}：${reward}`;
}

// ---------- input ----------
// key: 'up' | 'down' | 'enter' | 'back'。返回 false 表示未处理（交给系统，如主界面返回=退出）。
export function press(s, key, rng = Math.random) {
  const ap = s.ap;
  const handled = handleKey(s, key, rng);
  progress(s);
  flushStory(s);
  if (ap > 0 && s.ap === 0) s.ui.restHint = true;
  if (s.ui.screen === 'home') {
    const menu = homeMenu(s);
    if (s.ui.restHint && !s.ui.overlay) { s.ui.restHint = false; s.ui.focus = menu.indexOf('rest'); }
    s.ui.focus = clamp(s.ui.focus, 0, menu.length - 1); // 修补项会在耐久满后消失
  }
  return handled;
}

function handleKey(s, key, rng) {
  const ui = s.ui;
  if (ui.overlay) {
    const o = ui.overlay;
    // 带选项的弹窗（沉没、海盗、终章）：上下选、确认生效，返回键吞掉不作答
    if (o.options) {
      if (key === 'up' || key === 'down') o.pick = (o.pick + (key === 'down' ? 1 : -1) + o.options.length) % o.options.length;
      if (key !== 'enter') return true;
      if (o.kind === 'over') restart(s, o.pick === 0 && !!s.checkpoint);
      else if (o.kind === 'raid') resolveRaid(s, o.pick === 0);
      else if (o.kind === 'choice') chooseEnding(s, o.pick === 0);
      return true;
    }
    if (key === 'enter' || key === 'back') ui.overlay = null;
    return true;
  }

  const listLen = menuLength(s);
  if (key === 'up' || key === 'down') {
    if (ui.screen === 'salvage') { if (ui.salvage && !ui.salvage.done) salvageMove(s, key === 'down' ? 1 : -1); return true; }
    if (ui.chest) return true;
    if (listLen > 0) ui.focus = (ui.focus + (key === 'down' ? 1 : -1) + listLen) % listLen;
    return true;
  }

  if (key === 'back') {
    if (ui.screen === 'home') return false;
    if (ui.screen === 'salvage') { finishSalvage(s); return true; }
    if (ui.screen === 'mate') { ui.screen = 'crew'; ui.focus = Math.max(0, crewOf(s).indexOf(ui.mate)); return true; }
    ui.chest = null;
    const from = ui.screen;
    ui.screen = 'home';
    ui.focus = Math.max(0, homeMenu(s).indexOf(SCREEN_ITEM[from]));
    return true;
  }

  // enter
  switch (ui.screen) {
    case 'home': {
      const item = homeMenu(s)[ui.focus];
      if (item === 'salvage') {
        // 解锁了多个海域：先选海域
        if (zonesOf(s).length > 1) { ui.screen = 'zones'; ui.focus = 0; }
        else startSalvage(s, rng);
      } else if (item === 'build') { ui.screen = 'build'; ui.focus = 0; }
      else if (item === 'chests') { ui.screen = 'chests'; ui.focus = 0; ui.chest = null; }
      else if (item === 'repair') repair(s);
      else if (item === 'trader') { ui.screen = 'trade'; ui.focus = 0; }
      else if (item === 'crew') { ui.screen = 'crew'; ui.focus = 0; }
      else if (item === 'rest') endDay(s, rng);
      return true;
    }
    case 'crew': {
      const k = crewOf(s)[ui.focus];
      if (k) { ui.mate = k; ui.screen = 'mate'; ui.focus = 0; }
      return true;
    }
    case 'mate': {
      const act = mateMenu(s)[ui.focus];
      if (act === 'talk') talk(s, ui.mate);
      else if (dispatch(s, ui.mate, act)) { ui.screen = 'crew'; ui.focus = Math.max(0, crewOf(s).indexOf(ui.mate)); }
      return true;
    }
    case 'zones': {
      const z = zonesOf(s)[ui.focus];
      if (z === 'lab') diveLab(s);
      else startSalvage(s, rng, z); // 行动力不够时留在海域列表，消息栏提示
      return true;
    }
    case 'trade':
      if (!traderDay(s, s.day)) { ui.screen = 'home'; ui.focus = 0; ui.msg = '秤砣已经走了。'; return true; }
      trade(s, ui.focus);
      return true;
    case 'build':
      upgrade(s, buildMenu(s)[ui.focus]);
      return true;
    case 'chests':
      chestPress(s, rng);
      return true;
    case 'salvage':
      if (!ui.salvage || ui.salvage.done || ui.focus === salvageReturnIdx(ui.salvage)) finishSalvage(s);
      else dropHook(s, rng);
      return true;
  }
  return true;
}

function menuLength(s) {
  switch (s.ui.screen) {
    case 'home': return homeMenu(s).length;
    case 'build': return buildMenu(s).length;
    case 'zones': return zonesOf(s).length;
    case 'trade': return 3;
    case 'chests': return s.chests.length;
    case 'crew': return crewOf(s).length;
    case 'mate': return mateMenu(s).length;
    case 'salvage': return s.ui.salvage ? s.ui.salvage.items.length + 1 : 0;
    default: return 0;
  }
}

// ---------- view model ----------
const fmt = (n) => String(Math.floor(n + 1e-9));
const DIST = ['近', '近', '中', '远', '远'];

export function view(s) {
  const ui = s.ui;
  const c = caps(s);
  const r = rates(s);
  const t = tonight(s, r);
  const powered = t.ratio >= 1;
  const res = [
    { key: 'scrap', sym: SYM.scrap, label: RES_LABEL.scrap, val: fmt(s.res.scrap), cap: '' },
    { key: 'water', sym: SYM.water, label: RES_LABEL.water, val: fmt(s.res.water), cap: '/' + c.water },
    { key: 'power', sym: SYM.power, label: RES_LABEL.power, val: fmt(s.res.power), cap: '/' + c.power },
    { key: 'parts', sym: SYM.parts, label: RES_LABEL.parts, val: fmt(s.res.parts), cap: '' },
    { key: 'eels', sym: SYM.eels, label: RES_LABEL.eels, val: fmt(s.res.eels), cap: '' },
  ];
  // 危险夜预报（§9.4）：风暴或海盗，取最近的一个
  const nd = nextDanger(s);
  const when = (d) => (d.in === 0 ? '今晚' : `${d.in} 晚后`);
  const stormText = s.chapter < STORM_CHAPTER ? '风暴季未到'
    : !nd ? '3 晚内平静'
    : nd.kind === 'pirate' ? `${when(nd)}海盗 · 战力 ${nd.force}`
    : nd.in === 0 ? (nd.dmg ? `今晚风暴潮 -${nd.dmg}` : '今晚风暴潮 · 挡得住')
    : `${nd.in} 晚后风暴潮` + (nd.dmg ? ` -${nd.dmg}` : '');
  const danger = !!nd && (nd.kind === 'pirate' ? !nd.win : nd.dmg > 0);
  const vm = {
    screen: ui.screen,
    day: s.day,
    ap: s.ap,
    apPips: Array.from({ length: AP_MAX }, (_, i) => ({ i, full: i < s.ap })),
    hp: Math.round(s.hp),
    hpPct: Math.round((s.hp / HP_MAX) * 100),
    hpLow: s.hp <= 30,
    res,
    shelterLv: s.lv.shelter,
    shelterArt: levelArt('shelter', s.lv.shelter),
    decks: Array.from({ length: s.lv.shelter }, (_, i) => ({ i, w: 40 + i * 6 })).reverse(),
    stormText,
    stormDanger: danger,
    moreUp: false,
    moreDown: false,
    list: ['build', 'trade', 'zones', 'crew', 'mate'].includes(ui.screen),
    residents: residents(s),
    goal: null,
    prodText: `夜里 ${SYM.water}+${t.water}  ${SYM.power}+${r.gen}`,
    powerText: powered ? '过滤器 满速' : `今晚缺电 · 过滤器 ${Math.round(t.ratio * 100)}%`,
    msg: ui.msg,
    menu: [],
    salvage: null,
    chests: [],
    chest: null,
    overlay: ui.overlay ? overlayVm(ui.overlay) : null,
  };

  if (ui.screen === 'home') {
    vm.title = `庇护所 Lv${s.lv.shelter} · ${eraOf(s.lv.shelter)}`;
    const ch = CHAPTERS[s.chapter];
    const goals = ch.goals.map(([text, done]) => ({ text: goalText(s, text), done: done(s) }));
    const next = goals.find((g) => !g.done);
    vm.goal = ch.free && s.ending
      ? { chapter: ch.title, dots: '', text: ENDINGS[s.ending].goal }
      : { chapter: ch.title, dots: goals.map((g) => (g.done ? '●' : '○')).join(''), text: next ? next.text : '已完成' };
    const zones = zonesOf(s).filter((z) => ZONES[z].loot).length;
    const tired = (n) => s.ap < n;
    const items = {
      salvage: { label: '出海打捞', sub: zones > 1 ? `${zones} 片海域 · 行动${AP_COST.near}+` : `行动 ${AP_COST.near}`, off: tired(AP_COST.near) },
      build: { label: '建造与升级', sub: anyUpgradable(s) ? `可升级 · 行动 ${AP_COST.build}` : '', off: tired(AP_COST.build) },
      chests: { label: '宝箱', sub: s.chests.length ? `×${s.chests.length} · 行动 ${AP_COST.chest}` : '无', off: s.chests.length === 0 || tired(AP_COST.chest) },
      repair: { label: '修补庇护所', sub: `${SYM.scrap}${REPAIR_COST} → +${REPAIR_HP} · 行动 ${AP_COST.repair}`, off: s.res.scrap < REPAIR_COST || tired(AP_COST.repair) },
      trader: { label: '秤砣', sub: '今天在 · 不花行动', off: false },
      crew: { label: '居民', sub: crewSub(s), off: false },
      rest: { label: '结束今天', sub: s.ap ? `还剩 ${s.ap} 行动` : '行动力用完', off: false },
    };
    vm.menu = homeMenu(s).map((k) => ({ ...items[k], art: art(HOME_ART[k]) }));
    vm.tight = vm.menu.length > 5; // 居民、修补、秤砣同时出现时压低行高
  } else if (ui.screen === 'build') {
    vm.title = '建造与升级';
    const desc = {
      shelter: `Lv${s.lv.shelter} · 淡水上限 ${c.water} · 防御 ${12 * s.lv.shelter}`,
      armor: `Lv${s.lv.armor} · 风暴防御 +${10 * s.lv.armor}`,
      filter: `Lv${s.lv.filter} · 每晚 ${SYM.water}+${r.full} · 耗电 ${r.need}`,
      eel: `Lv${s.lv.eel} · 每晚 ${SYM.power}+${r.gen} · 待安置 ${SYM.eels}${s.res.eels}`,
      octo: `Lv${s.lv.octo} · 每晚 ${SYM.scrap}8→${SYM.parts}1 ×${s.lv.octo}`,
      crab: `Lv${s.lv.crab} · 每晚 ${SYM.scrap}+${3 * s.lv.crab}`,
      turtle: `Lv${s.lv.turtle} · ${s.lv.turtle >= 2 ? '可去沉城' : s.lv.turtle ? '可去残骸带 · Lv2 沉城' : '解锁残骸带'}`,
      lure: `Lv${s.lv.lure} · 远处 +${5 * s.lv.lure}% · 稀有 +${20 * s.lv.lure}%`,
    };
    const names = { shelter: '庇护所', filter: '海水过滤器', eel: '电鳗发电机', armor: '藤壶装甲', octo: '章鱼工坊', crab: '寄居蟹吊机', turtle: '海龟拖船', lure: '灯笼鱼信标' };
    vm.menu = buildMenu(s).map((k) => {
      const cost = costOf(s, k);
      const ok = affordable(s, cost);
      return {
        art: levelArt(ART_PREFIX[k], s.lv[k]),
        artDim: s.lv[k] === 0, // 未建造：显示 Lv1 外观但调暗
        label: names[k],
        sub: desc[k],
        cost: costText(cost),
        state: cost.max ? '满级' : cost.locked ? '锁定' : !ok ? '缺料' : s.ap < AP_COST.build ? '没力气' : '可升级',
        off: !ok || s.ap < AP_COST.build,
      };
    });
  } else if (ui.screen === 'zones') {
    vm.title = '选择海域';
    vm.menu = zonesOf(s).map((z) => ({
      art: art(ZONE_ART[z]), artDim: false, label: ZONES[z].label, sub: ZONES[z].sub,
      cost: z === 'wreck' && needBlueprint(s) ? `图纸 ${s.flags.blueprint || 0}/${BLUEPRINTS}`
        : z === 'sunken' && s.chapter >= 7 && !s.npc.bubble ? '有人求救'
        : z === 'sunken' && needKeycard(s) ? '门禁卡 0/1' : '',
      state: `行动 ${AP_COST[z]}`, off: s.ap < AP_COST[z],
    }));
  } else if (ui.screen === 'trade') {
    vm.title = '秤砣 · 今天的货';
    vm.menu = tradesOf(s).map((ti, i) => {
      const t = TRADES[ti];
      const used = tradeUsed(s, i);
      const ok = !used && affordable(s, t.give);
      return {
        art: t.get.chest ? art(`chest-${t.get.chest}-closed`) : '', artDim: false,
        label: `换 ${tradeGetText(t)}`, sub: `付 ${costText(t.give)}`, cost: '',
        state: used ? '已换' : ok ? '可换' : '缺料', off: !ok,
      };
    });
  } else if (ui.screen === 'crew') {
    vm.title = `居民 ×${residents(s)} · 派遣与聊天`;
    vm.menu = crewOf(s).map((k) => {
      const away = s.crew[k];
      return {
        art: art(CREW[k].art), artDim: !!away, label: NPC[k],
        sub: `擅长${ZONES[CREW[k].zone].label}` + (s.flags[`talked_${k}`] === s.day ? '' : ' · 想聊聊'),
        cost: hearts(bondOf(s, k)),
        state: away ? `${ZONES[away.zone].label} · 明早回` : '在船上', off: !!away,
      };
    });
  } else if (ui.screen === 'mate') {
    const k = ui.mate;
    const away = s.crew[k];
    vm.title = `${NPC[k]} · 好感 ${hearts(bondOf(s, k))}`;
    vm.menu = mateMenu(s).map((z) => {
      if (z === 'talk') {
        const talked = s.flags[`talked_${k}`] === s.day;
        return { art: art(CREW[k].art), artDim: false, label: '聊聊', sub: talked ? '今天聊过了' : '每天第一次 · 好感 +1', cost: '', state: away ? '出海中' : talked ? '聊过' : '可聊', off: !!away };
      }
      const ok = !away && s.res.water >= DISPATCH_WATER;
      return {
        art: art(ZONE_ART[z]), artDim: false, label: `派遣 · ${ZONES[z].label}`,
        sub: `不花行动 · 明早带回 ${dispatchSize(s, k, z)} 件` + (CREW[k].zone === z ? ' · 擅长' : ''),
        cost: `${SYM.water}${DISPATCH_WATER}`, state: away ? '出海中' : ok ? '可派' : '缺水', off: !ok,
      };
    });
  } else if (ui.screen === 'chests') {
    vm.title = `宝箱 ×${s.chests.length}`;
    vm.menu = s.chests.map((k) => ({ art: art(`chest-${k}-closed`), label: CHEST[k].label, sub: `行动 ${AP_COST.chest}`, off: s.ap < AP_COST.chest }));
    if (ui.chest) {
      const ch = ui.chest;
      vm.chest = { art: art(`chest-${ch.kind}-open`), label: CHEST[ch.kind].label, reward: ch.reward, hint: '确认 · 收下' };
    }
  } else if (ui.screen === 'salvage' && ui.salvage) {
    const sv = ui.salvage;
    vm.title = `出海 · ${ZONES[sv.zone].label}`;
    const ret = salvageReturnIdx(sv);
    vm.salvage = {
      hooks: Array.from({ length: sv.max || HOOKS_PER_TRIP }, (_, i) => ({ i, left: i < sv.hooks })),
      items: sv.items.map((it, i) => ({
        id: it.id,
        art: it.hidden || it.caught ? '' : art(LOOT_ART[it.kind]),
        tag: it.hidden ? '？' : it.caught ? (it.missed ? '×' : '✓') : it.tag,
        label: it.hidden ? '看不清' : it.label,
        dist: DIST[i] || '远',
        pct: it.caught ? '' : `${Math.round(it.odds * 100)}%`,
        caught: it.caught,
        focused: !sv.done && ui.focus === i,
      })),
      back: { focused: sv.done || ui.focus === ret },
      pending: sv.pending.length ? `船上 ${sv.pending.length} 件` : '',
      last: sv.last,
      done: sv.done,
      hint: sv.done ? '确认 · 返航' : ui.focus === ret ? '确认 · 返航（收获入库）' : '确认 · 落钩    返回 · 返航',
    };
  }
  vm.menu = vm.menu.map((m, i) => ({ ...m, i, focused: i === ui.focus && !ui.chest }));
  // 列表超过一屏时滚动，焦点项始终可见
  if (vm.list && vm.menu.length > BUILD_ROWS) {
    const top = clamp(ui.focus - 1, 0, vm.menu.length - BUILD_ROWS);
    vm.moreUp = top > 0;
    vm.moreDown = top + BUILD_ROWS < vm.menu.length;
    vm.menu = vm.menu.slice(top, top + BUILD_ROWS);
  }
  return vm;
}

function overlayVm(o) {
  const { options, pick, ...rest } = o;
  const vm = { ...rest, art: overlayArt(o), opts: null };
  if (options) vm.opts = options.map((label, i) => ({ i, label, focused: i === pick }));
  return vm;
}
function crewSub(s) {
  const away = Object.keys(s.crew).length;
  return away ? `${away} 人出海 · 明早回` : `${residents(s)} 人在船`;
}
function anyUpgradable(s) {
  return buildMenu(s).some((k) => affordable(s, costOf(s, k)));
}
