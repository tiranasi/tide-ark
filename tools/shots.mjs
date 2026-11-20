// 给 preview/scenes.js 里的每个场景截一张 480×352 的图，输出到 docs/screenshots/。
// 用法：node tools/shots.mjs [场景名前缀…]
// 需要本机装有 Chrome / Edge（CHROME 环境变量可指定路径）；会临时启动 tools/serve.mjs。
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES } from '../preview/scenes.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'docs', 'screenshots');
const PORT = 5190;
const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);
const CHROME = CANDIDATES.find((p) => existsSync(p));
if (!CHROME) { console.error('找不到 Chrome，用 CHROME=路径 指定'); process.exit(1); }

const only = process.argv.slice(2);
const list = SCENES.filter(([name]) => !only.length || only.some((p) => name.startsWith(p)));

const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
// 等预览服务器就绪（Windows 上 600ms 不够，前几张会截到空白页）
for (let i = 0; i < 50; i++) {
  try { const r = await fetch(`http://localhost:${PORT}/preview/`); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
mkdirSync(OUT, { recursive: true });

try {
  for (const [name, title] of list) {
    const profile = mkdtempSync(join(tmpdir(), 'tideark-shot-'));
    const file = join(OUT, `${name}.png`);
    execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--user-data-dir=${profile}`, '--window-size=480,352', '--virtual-time-budget=4000',
      `--screenshot=${file}`, `http://localhost:${PORT}/preview/?scene=${name}&shot=1`,
    ], { stdio: 'ignore', timeout: 60000 });
    // Chrome 退出后可能还占着配置目录：重试几次，删不掉也不影响截图
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
    console.log(`✓ ${name}  ${title}`);
  }
} finally {
  server.kill();
}

// 索引页（全量截图时才重写）
if (!only.length) {
  const rows = SCENES.map(([name, title]) => `| ${name} | ${title} | ![${title}](${name}.png) |`);
  writeFileSync(join(OUT, 'README.md'), [
    '# 潮汐方舟 · 界面截图',
    '',
    '由 `node tools/shots.mjs` 生成：每张图来自 `preview/scenes.js` 里的一个固定场景，在浏览器预览里按眼镜画布 480×352 截取。',
    '真机显示以 AIUI 模拟器 / Rokid 眼镜为准。交互说明见 [交互设计](../交互设计.md)。',
    '',
    '| 场景 | 说明 | 截图 |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n'));
}
