// 本地 AIX 工作流：只把 agent/ 复制到 build/aix/staging 再交给官方 CLI。
//   node tools/aix.mjs show              查看 CLI 解析出的 Agent Definition
//   node tools/aix.mjs pack              打包到 dist/tide-ark-<version>.aix
//   node tools/aix.mjs install [serial]  用固定开发 agent ID 安装到眼镜并打开首页
//   node tools/aix.mjs install [serial] --scene 19-talk   调试：从预览场景开局
// 重装不会让眼镜上已打开的旧实例退出：先按返回关掉页面再安装，或安装后重新 launch-page。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'agent');
const work = path.join(root, 'build', 'aix');
const staging = path.join(work, 'staging');
const dist = path.join(root, 'dist');
const cli = path.join(root, 'node_modules', '@yodaos-pkg', 'aix-cli', 'dist', 'cli.js');
// 固定后缀：重复安装覆盖同一个开发应用，而不是每次新建
const DEV_AGENT_ID = 'tideark_dev';
const ENTRY = 'pages/index/index';
const mode = process.argv[2] || 'show';

function runCli(args, capture = false) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 16 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (capture) process.stderr.write(r.stderr || r.stdout || '');
    throw new Error(`aix ${args[0]} failed (${r.status})`);
  }
  return r.stdout || '';
}

function assertInside(parent, target) {
  const rel = path.relative(path.resolve(parent), path.resolve(target));
  assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel), `Unsafe build path: ${target}`);
}

// 仅调试安装：暂存目录里的页面从 preview/scenes.js 的固定场景开局（忽略存档）。源码不变。
async function injectScene(name) {
  const scenes = await import(new URL('../preview/scenes.js', import.meta.url));
  assert.ok(scenes.SCENES.some(([id]) => id === name), `Unknown scene: ${name}`);
  await fs.copyFile(path.join(root, 'preview', 'scenes.js'), path.join(staging, 'core', 'debug-scenes.js'));
  const file = path.join(staging, `${ENTRY}.ink`);
  let src = await fs.readFile(file, 'utf8');
  const load = 'this.state = G.restore(this.loadSave());';
  assert.ok(src.includes(load), 'Entry page load line changed; update injectScene.');
  src = src
    .replace("import * as G from '../../core/game.js';", "import * as G from '../../core/game.js';\nimport { SCENES as DEBUG_SCENES } from '../../core/debug-scenes.js';")
    .replace(load, `this.state = DEBUG_SCENES.find(([id]) => id === ${JSON.stringify(name)})[2](G); console.log('[tideark] debug scene ${name}');`);
  await fs.writeFile(file, src);
}

async function prepare(dev, scene) {
  assertInside(root, staging);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  await fs.cp(source, staging, { recursive: true });
  if (scene) await injectScene(scene);
  if (dev) {
    // CLI 对目录输入读取 .aix/agent-id（打包时跳过该目录）
    await fs.mkdir(path.join(staging, '.aix'), { recursive: true });
    await fs.writeFile(path.join(staging, '.aix', 'agent-id'), `${DEV_AGENT_ID}\n`);
  }
  const def = JSON.parse(runCli(['show', staging, '--compact'], true));
  if (dev) assert.equal(def.agentId, `develop.rokid.agent.${DEV_AGENT_ID}`);
  return def;
}

async function main() {
  await fs.access(cli).catch(() => { throw new Error('先运行 npm install 安装 @yodaos-pkg/aix-cli'); });
  if (mode === 'show') {
    console.log(JSON.stringify(await prepare(true), null, 2));
    return;
  }
  if (mode === 'pack') {
    const def = await prepare(false);
    const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
    await fs.mkdir(dist, { recursive: true });
    const out = path.join(dist, `tide-ark-${pkg.version}.aix`);
    runCli(['pack', staging, '-o', out]);
    console.log(`Created ${out} (${(await fs.stat(out)).size} bytes), agent ${def.agentName}.`);
    return;
  }
  if (mode === 'install') {
    const args = process.argv.slice(3);
    const si = args.indexOf('--scene');
    const scene = si >= 0 ? args.splice(si, 2)[1] : null;
    const serial = args[0] || process.env.ANDROID_SERIAL;
    const sArgs = serial ? ['-s', serial] : [];
    await prepare(true, scene);
    if (scene) console.log(`Debug scene: ${scene} (staging only; the page ignores the save)`);
    runCli(['install', staging, ...sArgs]);
    runCli(['launch-page', staging, ENTRY, ...sArgs]);
    console.log(`Installed develop.rokid.agent.${DEV_AGENT_ID}${serial ? ` on ${serial}` : ''} and opened ${ENTRY}.`);
    return;
  }
  throw new Error('Use show, pack, or install.');
}

main().catch((err) => { console.error(`[aix] ${err.message}`); process.exitCode = 1; });
