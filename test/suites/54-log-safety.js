'use strict';
// Logging can never loop or fill the disk. A closed stdout pipe made console writes fail with EPIPE; the
// uncaught-exception handler logged that with console.error, which failed with EPIPE again, forever (a 27 GB node.log).
// src/main/safe-log.js: closed stdout / stderr are detected and skipped, the handlers ignore pipe errors and cannot
// re-enter, node.log is capped at 5 MB with one older file kept. Used by the desktop main process and the iPad runtime.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const procs = require('../lib/procs');
const SL = require('../../src/main/safe-log.js');
const ROOT = path.join(__dirname, '..', '..');
const FIX = path.join(__dirname, '..', 'fixtures', 'log-safety');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// spawn, wait for the first output, then close our end of stdout + stderr (the reader goes away)
async function runAndClose(bin, args, opts) {
  const p = procs.track(spawn(bin, args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'], detached: true }, opts)));
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no output')), 15000); p.stdout.once('data', () => { clearTimeout(t); res(); }); });
  p.stdout.destroy(); p.stderr.destroy();
  return p;
}
const exitOf = (p, ms) => new Promise(res => { if (p.exitCode !== null) return res(p.exitCode); const t = setTimeout(() => res('running'), ms); p.on('exit', c => { clearTimeout(t); res(c); }); });
const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };

module.exports = async ({ test, group, assert, eq }) => {
  group('日志安全：标准输出关闭（EPIPE）不再死循环，日志文件有大小上限（桌面主进程与 iPad 运行时）');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-logsafe-'));
  try {
    await test('日志轮转：每个文件不超过上限，只保留 node.log 与 node.log.1', async () => {
      const f = path.join(tmp, 'rot', 'node.log'); fs.mkdirSync(path.dirname(f));
      const w = SL.rotatingLog(f, { maxBytes: 100 * 1024, keep: 2 });
      const line = 'x'.repeat(1023) + '\n';
      for (let i = 0; i < 1000; i++) w(line); // ~1 MB written
      assert(sizeOf(f) <= 100 * 1024 && sizeOf(f + '.1') <= 100 * 1024 && sizeOf(f + '.1') > 90 * 1024, sizeOf(f) + ' / ' + sizeOf(f + '.1'));
      eq(fs.readdirSync(path.dirname(f)).sort().join(','), 'node.log,node.log.1');
      // an oversized file left by an older version is rotated away at start
      fs.writeFileSync(f, 'y'.repeat(300 * 1024));
      SL.rotatingLog(f, { maxBytes: 100 * 1024 })('z\n');
      eq(sizeOf(f), 2, 'fresh file after start'); eq(fs.readdirSync(path.dirname(f)).length, 2, 'still two files');
    });
    await test('处理器防重入：管道错误被忽略，处理器内再出错不会递归', async () => {
      let n = 0;
      const h = SL.guardedHandler(() => { n++; h(new Error('inner')); throw new Error('boom'); });
      h(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })); eq(n, 0, 'EPIPE ignored');
      h(new Error('x')); eq(n, 1, 'no re-entry, no throw');
    });
    await test('桌面主进程模式：读取端关闭后持续输出与未捕获异常均不引发循环，进程正常运行，日志按行增长', async () => {
      const f = path.join(tmp, 'desk', 'main.log'); fs.mkdirSync(path.dirname(f));
      const p = await runAndClose(process.execPath, ['-r', path.join(FIX, 'preload-ticks.js'), path.join(FIX, 'child.js'), f], { env: Object.assign({}, process.env, { AIB_TICKS_MS: '2000' }) });
      eq(await exitOf(p, 10000), 0, 'exits normally');
      eq(fs.readFileSync(f + '.uncaught', 'utf8'), '1', 'exactly one real uncaught error handled');
      const text = fs.readFileSync(f, 'utf8') + (fs.existsSync(f + '.1') ? fs.readFileSync(f + '.1', 'utf8') : '');
      const ticks = (text.match(/^log tick/gm) || []).length, unc = (text.match(/^error uncaught/gm) || []).length;
      assert(ticks > 30 && ticks < 200, 'ticks ' + ticks); eq(unc, 1, 'uncaught logged once (no EPIPE loop)');
      assert(sizeOf(f) + sizeOf(f + '.1') < 64 * 1024 * 2, 'bounded');
    });
    await test('桌面 main.js 使用 safe-log：控制台已包装，未捕获异常 / Promise 拒绝处理器带防护', async () => {
      const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.js'), 'utf8');
      assert(/require\('\.\/safe-log'\)/.test(src) && /safeLog\.wrapConsole\(\)/.test(src), 'console wrapped');
      assert(!/process\.on\('uncaughtException', \(e\)/.test(src) && !/process\.on\('unhandledRejection', \(e\)/.test(src), 'no unguarded handlers');
      eq((src.match(/process\.on\('(uncaughtException|unhandledRejection)', safeLog\.guardedHandler/g) || []).length, 2);
    });
    await test('iPad 运行时（main-ipad.js，Node 18）：读取端关闭后不循环写日志，node.log 有上限；模拟器进程消失后自行退出', async () => {
      const bundle = process.env.AIB_IPAD_BUNDLE || path.join(ROOT, 'dist', 'ipad-bundle');
      const np = path.join(bundle, 'nodejs-project');
      if (!fs.existsSync(path.join(np, 'main-ipad.js')) || process.env.AIB_IPAD_REBUILD === '1') {
        require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ipad-bundle.js'), bundle], { stdio: 'ignore', timeout: 600000 });
      }
      const node = process.env.AIB_NODE || process.execPath;
      const ud = path.join(tmp, 'ipad-ud'), docs = path.join(tmp, 'ipad-docs');
      // a parent stand-in that exits after 3.5 s: main-ipad.js must follow it
      const parent = procs.track(spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3500)'], { stdio: 'ignore', detached: true }));
      const p = await runAndClose(node, ['--jitless', '-r', path.join(FIX, 'preload-ticks.js'), path.join(np, 'main-ipad.js'), '--port', '1', '--token', 't', '--userdata', ud, '--documents', docs, '--tmp', tmp, '--resources', bundle],
        { cwd: np, env: Object.assign({}, process.env, { AIB_SIM_PARENT_PID: String(parent.pid), AIB_TICKS_MS: '2500' }) });
      await sleep(3000);
      const log = path.join(ud, 'logs', 'node.log');
      const s1 = sizeOf(log); await sleep(1000); const s2 = sizeOf(log);
      const text = fs.readFileSync(log, 'utf8');
      const unc = (text.match(/\] error uncaught Error: test uncaught error/g) || []).length;
      const epipe = (text.match(/EPIPE/g) || []).length;
      eq(unc, 1, 'one uncaught line'); eq(epipe, 0, 'no EPIPE lines');
      assert(s1 < 512 * 1024, 'node.log small: ' + s1);
      assert(/done/.test(text) || s2 - s1 < 16 * 1024, 'not growing after the ticks stop: ' + s1 + ' → ' + s2);
      assert(fs.existsSync(path.join(docs, '日志', 'node.log')), 'Documents mirror');
      eq(await exitOf(p, 8000), 0, 'exits after the simulator process is gone');
    });
    await test('测试工具：测试进程退出或中断时，所有派生进程（含孙进程）都被结束', async () => {
      for (const how of ['exit', 'SIGTERM', 'crash']) {
        const pidFile = path.join(tmp, 'pids-' + how);
        const code = `const { spawn } = require('child_process'); const procs = require(${JSON.stringify(path.join(ROOT, 'test', 'lib', 'procs.js'))});
          const p = procs.track(spawn('sh', ['-c', 'sleep 60 & echo $! > ${pidFile}; sleep 60'], { detached: true, stdio: 'ignore' }));
          setTimeout(() => { require('fs').appendFileSync(${JSON.stringify(pidFile)}, ' ' + p.pid); ${how === 'exit' ? 'process.exit(0)' : how === 'crash' ? "throw new Error('harness crash')" : ''} }, 400);
          setInterval(() => {}, 1000);`;
        const h = spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
        await sleep(900);
        if (how === 'SIGTERM') h.kill('SIGTERM');
        await exitOf(h, 5000); await sleep(300);
        const pids = fs.readFileSync(pidFile, 'utf8').trim().split(/\s+/).map(Number);
        eq(pids.length, 2, how + ' pids');
        for (const pid of pids) { let alive = true; try { process.kill(pid, 0); } catch { alive = false; } assert(!alive, how + ': process ' + pid + ' still running'); }
      }
    });
  } finally {
    procs.killAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};
