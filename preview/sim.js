// 简化版 AIUI 运行时，仅用于浏览器预览：
// 读取 .ink 文件 → 注入 <style> → 以 ES 模块加载 <script setup> → 用 ink:if/elif/else/for 渲染 <page> 模板。
// 支持 Page 生命周期 onLoad/onShow/onHide/onUnload（页面可以不实现其中一些）、setData（含点路径）、onKeyDown/onKeyUp、wx 存储。

import * as G from '../agent/core/game.js';
import { SCENES } from './scenes.js';

// ?scene=04-home-late 打开固定场景；再加 &shot=1 只留 480×352 画面（给 tools/shots.mjs 截图）
const params = new URLSearchParams(location.search);
const SCENE = params.get('scene');
if (params.get('shot')) document.body.classList.add('shot');

const INK_URL = new URL('../agent/pages/index/index.ink', import.meta.url).href;
const frame = document.getElementById('frame');
const logEl = document.getElementById('log');
const log = (msg) => { logEl.textContent = msg; };

// ---------- wx shim ----------
window.__wx = {
  getStorageSync(key) {
    const raw = localStorage.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  },
  setStorageSync(key, data) { localStorage.setItem(key, JSON.stringify(data)); },
  removeStorageSync(key) { localStorage.removeItem(key); },
  navigateBack() { log('wx.navigateBack()'); },
};

// ---------- .ink parsing ----------
function block(src, tag) {
  const m = src.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag.split(' ')[0]}>`));
  return m ? m[1] : '';
}

async function loadInk() {
  const src = await (await fetch(INK_URL, { cache: 'no-store' })).text();
  const script = src.match(/<script setup>([\s\S]*?)<\/script>/)[1]
    .replace(/import\s+wx\s+from\s+['"]wx['"];?/, 'const wx = window.__wx;')
    // 浏览器预览没有 AIUI 大模型：给 undefined，页面退回写好的台词
    .replace(/import\s+\{\s*LanguageModel\s*\}\s+from\s+['"]language-model['"];?/, 'const LanguageModel = window.LanguageModel;')
    .replace(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g, (_, p) => `from '${new URL(p, INK_URL).href}'`);
  const style = block(src, 'style');
  const template = block(src, 'page');
  const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
  const mod = await import(url);
  URL.revokeObjectURL(url);
  return { def: mod.default, style, template };
}

// ---------- template rendering ----------
const fnCache = new Map();
function evalExpr(expr, scope) {
  try {
    let fn = fnCache.get(expr);
    if (!fn) {
      fn = new Function('__s', `with (__s) { return (${expr}); }`);
      fnCache.set(expr, fn);
    }
    return fn(scope);
  } catch (e) { console.warn('expr error', expr, e); return undefined; }
}
function interp(str, scope) {
  // 整段只有一个绑定时保留原始类型（数组/布尔），否则做字符串插值
  const whole = str.match(/^\s*\{\{((?:(?!\}\})[\s\S])+)\}\}\s*$/);
  if (whole) return evalExpr(whole[1], scope);
  return str.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => {
    const v = evalExpr(e, scope);
    return v == null ? '' : String(v);
  });
}

function renderChildren(src, scope, out) {
  let chain = null; // null: 无条件链；true: 已命中；false: 未命中
  for (const child of src.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!child.textContent.trim()) continue;
      out.appendChild(document.createTextNode(interp(child.textContent.trim(), scope)));
      chain = null;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const a = (n) => child.getAttribute(n);
    if (child.hasAttribute('ink:for')) {
      const list = interp(a('ink:for'), scope) || [];
      const itemName = a('ink:for-item') || 'item';
      const indexName = a('ink:for-index') || 'index';
      list.forEach((item, i) => {
        const s = Object.create(scope);
        s[itemName] = item;
        s[indexName] = i;
        if (child.hasAttribute('ink:if') && !interp(a('ink:if'), s)) return;
        out.appendChild(renderElement(child, s));
      });
      chain = null;
    } else if (child.hasAttribute('ink:if')) {
      chain = !!interp(a('ink:if'), scope);
      if (chain) out.appendChild(renderElement(child, scope));
    } else if (child.hasAttribute('ink:elif')) {
      if (chain === false && interp(a('ink:elif'), scope)) { chain = true; out.appendChild(renderElement(child, scope)); }
    } else if (child.hasAttribute('ink:else')) {
      if (chain === false) out.appendChild(renderElement(child, scope));
      chain = null;
    } else {
      out.appendChild(renderElement(child, scope));
      chain = null;
    }
  }
}

function renderElement(src, scope) {
  const el = document.createElement(src.tagName.toLowerCase());
  for (const { name, value } of src.attributes) {
    if (name.startsWith('ink:') || name.startsWith('bind') || name.startsWith('catch')) continue;
    el.setAttribute(name, String(interp(value, scope) ?? ''));
  }
  if (el.tagName === 'IMG') fixImage(el); // HTML 解析器会把 <image> 变成 <img>
  renderChildren(src, scope, el);
  return el;
}

// AIUI <image>：src 相对 .ink 文件解析；mode → object-fit
const IMG_FIT = { aspectFit: 'contain', aspectFill: 'cover', scaleToFill: 'fill', widthFix: 'contain', heightFix: 'contain' };
function fixImage(el) {
  const src = el.getAttribute('src');
  if (src) el.setAttribute('src', new URL(src, INK_URL).href);
  el.style.objectFit = IMG_FIT[el.getAttribute('mode')] || 'fill';
  el.alt = '';
}

// ---------- page instance ----------
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

let page = null;
let tpl = null;
let renderQueued = false;

function render() {
  renderQueued = false;
  if (!page) return; // 页面已卸载（模拟关闭智能体）后残留的帧
  const out = document.createDocumentFragment();
  renderChildren(tpl.content, page.data, out);
  frame.replaceChildren(out);
}

async function mount() {
  const { def, style, template } = await loadInk();
  if (!document.getElementById('ink-style')) {
    const st = document.createElement('style');
    st.id = 'ink-style';
    // AIUI 中 100vh = 眼镜画布高度；预览里固定为 352px
    st.textContent = style + '\n#frame .root { height: 352px !important; }';
    document.head.appendChild(st);
  }
  tpl = document.createElement('template');
  tpl.innerHTML = template;
  page = { ...def, data: structuredClone(def.data) };
  page.setData = function (patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (k.includes('.')) setPath(this.data, k, structuredClone(v));
      else this.data[k] = structuredClone(v);
    }
    if (!renderQueued) { renderQueued = true; requestAnimationFrame(render); }
  };
  window.__page = page; // 调试用
  page.onLoad && page.onLoad({});
  page.onShow && page.onShow();
  if (SCENE) {
    // 截图模式：换成固定场景，不写存档
    const found = SCENES.find(([name]) => name === SCENE);
    if (!found) { log('没有这个场景：' + SCENE); return; }
    page.save = () => {};
    page.state = found[2](G);
    page.render();
    log(`场景 ${found[0]} · ${found[1]}`);
  }
  render();
  if (SCENE) requestAnimationFrame(() => { document.body.dataset.ready = '1'; });
}

function unmount() {
  if (!page) return;
  page.onHide && page.onHide();
  page.onUnload && page.onUnload();
  page = null;
  frame.replaceChildren();
}

// ---------- input ----------
function sendKey(code) {
  if (!page) return;
  page.onKeyDown && page.onKeyDown({ code, preventDefault() {} });
  let prevented = false;
  page.onKeyUp && page.onKeyUp({ code, preventDefault() { prevented = true; } });
  if (prevented) { log(`${code} · 页面已处理`); return; }
  if (code === 'Backspace') {
    log('Backspace 未拦截 → 宿主关闭智能体（1 秒后模拟重新打开，验证存档）');
    unmount();
    setTimeout(mount, 1000);
  } else {
    log(`${code} · 交给宿主默认行为`);
  }
}

const KEYS = { ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', Enter: 'Enter', Backspace: 'Backspace', Escape: 'Backspace', ' ': 'Enter' };
window.addEventListener('keydown', (e) => {
  const code = KEYS[e.key];
  if (!code) return;
  e.preventDefault();
  if (!e.repeat) sendKey(code);
});
document.querySelectorAll('button[data-key]').forEach((b) =>
  b.addEventListener('click', () => { sendKey(b.dataset.key); b.blur(); }));

document.getElementById('env').addEventListener('click', (e) => { frame.classList.toggle('env-street'); e.target.blur(); });
document.getElementById('fast').addEventListener('click', (e) => {
  e.target.blur();
  if (!page || !page.state) return;
  page.state.ap = G.AP_MAX; // 调试：补满行动力
  page.render();
  log('行动力已补满');
});
document.getElementById('reset').addEventListener('click', (e) => {
  e.target.blur();
  unmount();
  localStorage.removeItem(G.SAVE_KEY);
  mount();
  log('存档已清空');
});

mount().catch((err) => { log('加载失败：' + err); console.error(err); });
