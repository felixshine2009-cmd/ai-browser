'use strict';
// v6.0.1: opening the UI must leave the app idle — low CPU, no continuous layouts / style recalcs / rAF loops — even
// while a local framework (Ollama here, faked) is running. 6.0.0 looped models:picker ⇄ 'models:changed' forever.
const { launch, sleep, seedSettings } = require('../lib/app');
const http = require('http'), os = require('os'), fs = require('fs'), path = require('path');
const { execSync } = require('child_process');

function tree(pid) {
  const rows = execSync('ps -e -o pid=,ppid=').toString().trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
  const s = new Set([pid]); let more = true;
  while (more) { more = false; for (const [p, pp] of rows) if (s.has(pp) && !s.has(p)) { s.add(p); more = true; } }
  return [...s];
}
function ticks(pids) { let t = 0; for (const p of pids) { try { const f = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(') ')[1].split(' '); t += +f[11] + +f[12]; } catch {} } return t; }

module.exports = async ({ test, group, assert }) => {
  group('空闲性能：打开主页后 CPU 保持低位，无持续布局或动画帧循环（含本地 Ollama 运行时）');
  let hits = 0;
  const srv = http.createServer((q, r) => { hits++; r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(q.url.includes('/api/tags') ? { models: [{ name: 'qwen3:4b', model: 'qwen3:4b' }] } : { data: [] })); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-idle-'));
  const off = { enabled: false };
  seedSettings(ud, { onboarding: { completed: true, skipped: false, completedAt: 1 },
    ai: { local: { frameworks: { overrides: { ollama: { host: '127.0.0.1', port }, lmstudio: off, omlx: off, mlxlm: off, jan: off } } } } });
  const app = await launch({ userData: ud });
  try {
    await app.waitPage(u => u.startsWith('aibrowser://home'));
    await sleep(4000);
    await test('主页与工具栏空闲 4 秒：无持续布局、样式计算或 requestAnimationFrame 循环', async () => {
      const ms = [];
      for (const p of app.pages()) {
        const c = await p.context().newCDPSession(p); await c.send('Performance.enable');
        await p.evaluate(() => { window.__rafN = 0; const o = window.requestAnimationFrame; window.requestAnimationFrame = (f) => { window.__rafN++; return o.call(window, f); }; }).catch(() => {});
        ms.push([p, c]);
      }
      const get = () => Promise.all(ms.map(async ([p, c]) => { const o = {}; for (const x of (await c.send('Performance.getMetrics')).metrics) o[x.name] = x.value; return o; }));
      const a = await get(); await sleep(4000); const b = await get();
      for (let i = 0; i < ms.length; i++) {
        const u = ms[i][0].url();
        const lay = b[i].LayoutCount - a[i].LayoutCount, sty = b[i].RecalcStyleCount - a[i].RecalcStyleCount;
        const raf = await ms[i][0].evaluate(() => window.__rafN || 0).catch(() => 0);
        assert(lay <= 4 && sty <= 8, `${u}: ${lay} layouts / ${sty} style recalcs in 4 s while idle`);
        assert(raf <= 4, `${u}: ${raf} requestAnimationFrame calls in 4 s while idle`);
      }
    });
    await test('全部进程空闲 CPU 低于 15%，且不会反复探测本地框架', async () => {
      const pids = tree(app.proc.pid); const hz = 100;
      const h0 = hits, t0 = ticks(pids); await sleep(5000); const t1 = ticks(pids);
      const pct = (t1 - t0) / hz / 5 * 100;
      assert(pct < 15, `idle CPU ${pct.toFixed(1)}% over 5 s`);
      assert(hits - h0 <= 2, `local framework probed ${hits - h0} times in 5 s`);
    });
  } finally { await app.close(); srv.close(); }
};
