'use strict';
// v3.3.0 — resumable downloads (pure Node, mocked local HTTP server; no real model downloads, no inference)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
process.env.AIB_DL_BACKOFF_MS = '15'; process.env.AIB_DL_BACKOFF_MAX_MS = '60';
const dl = require('../../src/main/ai/dl');

const DATA = crypto.randomBytes(3 * 1024 * 1024 + 123);
const SHA = crypto.createHash('sha256').update(DATA).digest('hex');

function serve(opt = {}) {
  const log = []; let n = 0;
  const srv = http.createServer((req, res) => {
    const i = n++; const range = req.headers.range; log.push({ range: range || '', i });
    let start = 0; if (range && !opt.ignoreRange) { const m = range.match(/bytes=(\d+)-/); start = Number(m[1]); }
    if (opt.http500 && i < opt.http500) { res.statusCode = 500; return res.end('x'); }
    let body = DATA.subarray(start);
    if (opt.corruptFirst && i === 0) { body = Buffer.from(body); body[100] ^= 0xff; }
    if (opt.alwaysCorrupt) { body = Buffer.from(body); body[5] ^= 0xff; }
    const partial = start > 0;
    res.writeHead(partial ? 206 : 200, { 'content-length': body.length, ...(partial ? { 'content-range': `bytes ${start}-${DATA.length - 1}/${DATA.length}` } : {}), 'accept-ranges': 'bytes' });
    const dropAt = opt.dropAfter && (opt.dropTimes == null || i < opt.dropTimes) ? opt.dropAfter : 0;
    let sent = 0; const CH = 64 * 1024;
    const pump = () => {
      if (res.destroyed) return;
      if (dropAt && sent >= dropAt) return res.socket.destroy(); // network drop mid-body
      if (sent >= body.length) return res.end();
      const slice = body.subarray(sent, Math.min(sent + CH, body.length)); sent += slice.length;
      res.write(slice, () => setTimeout(pump, opt.delay || 0));
    };
    pump();
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, log, url: `http://127.0.0.1:${srv.address().port}/m.gguf`, close: () => new Promise(c => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(c); }) })));
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aib-dl-'));
const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

module.exports = async ({ test, group, assert }) => {
  group('可恢复下载（v3.3.0，mock HTTP）');

  await test('连接中途断开 → 自动退避重试，用 Range 续传，最终 sha256 正确', async () => {
    const s = await serve({ dropAfter: 1024 * 1024, dropTimes: 2 }); const d = path.join(tmp(), 'm.gguf'); const ev = [];
    try {
      const r = await dl.fetchResumable({ id: 't1', urls: [s.url], dest: d, expectBytes: DATA.length, sha256: SHA, onStatus: e => ev.push(e.state) });
      assert(shaOf(d) === SHA, 'hash');
      assert(s.log.length >= 3, 'requests: ' + s.log.length);
      assert(s.log[0].range === '' && /^bytes=\d+-$/.test(s.log[1].range) && /^bytes=\d+-$/.test(s.log[2].range), JSON.stringify(s.log));
      assert(Number(s.log[1].range.match(/\d+/)[0]) >= 64 * 1024, 'resumed from a non-zero offset: ' + s.log[1].range);
      assert(ev.includes('retrying') && ev.includes('verifying') && ev.includes('done'), ev.join());
      assert(r.retries >= 2 && !fs.existsSync(d + '.part') && !fs.existsSync(d + '.part.json'), 'cleanup');
    } finally { await s.close(); }
  });

  await test('应用重启 / 崩溃后：已有 .part 用 Range 继续（不重头下载）', async () => {
    const s = await serve(); const dir = tmp(); const d = path.join(dir, 'm.gguf');
    fs.writeFileSync(d + '.part', DATA.subarray(0, 1234567)); fs.writeFileSync(d + '.part.json', JSON.stringify({ id: 'old', expectBytes: DATA.length, sha256: SHA }));
    try {
      await dl.fetchResumable({ id: 't2', urls: [s.url], dest: d, expectBytes: DATA.length, sha256: SHA });
      assert(s.log.length === 1 && s.log[0].range === 'bytes=1234567-', JSON.stringify(s.log));
      assert(shaOf(d) === SHA, 'hash');
    } finally { await s.close(); }
  });

  await test('服务器忽略 Range（返回 200）→ 干净地从头重来，结果正确', async () => {
    const s = await serve({ ignoreRange: true }); const d = path.join(tmp(), 'm.gguf'); const ev = [];
    fs.writeFileSync(d + '.part', DATA.subarray(0, 500000));
    try {
      const r = await dl.fetchResumable({ id: 't3', urls: [s.url], dest: d, expectBytes: DATA.length, sha256: SHA, onStatus: e => ev.push(e.state + (e.reason ? ':' + e.reason : '')) });
      assert(shaOf(d) === SHA && r.restarts === 1, 'restart count ' + r.restarts);
      assert(ev.some(x => x === 'restart:no-range'), ev.join());
    } finally { await s.close(); }
  });

  await test('镜像回退：第一个源不可达 → 切到第二个源，继续同一个 .part', async () => {
    const s = await serve({ dropAfter: 900 * 1024, dropTimes: 1 }); const d = path.join(tmp(), 'm.gguf');
    const dead = 'http://127.0.0.1:1/m.gguf';
    try {
      const r = await dl.fetchResumable({ id: 't4', urls: [dead, s.url], dest: d, expectBytes: DATA.length, sha256: SHA });
      assert(shaOf(d) === SHA, 'hash');
      assert(s.log.length === 2 && /^bytes=\d+-$/.test(s.log[1].range), 'resumed on the mirror: ' + JSON.stringify(s.log));
      assert(r.via === s.url, 'via');
    } finally { await s.close(); }
  });

  await test('暂停保留 .part；继续时用 Range 完成', async () => {
    const s = await serve({ delay: 15 }); const d = path.join(tmp(), 'm.gguf'); const ac = new AbortController(); let paused = false;
    try {
      const p = dl.fetchResumable({ id: 't5', urls: [s.url], dest: d, expectBytes: DATA.length, sha256: SHA, signal: ac.signal });
      const iv = setInterval(() => { try { if (fs.statSync(d + '.part').size > 300000) { ac.abort('pause'); clearInterval(iv); } } catch {} }, 5);
      try { await p; } catch (e) { paused = !!e.paused; }
      assert(paused, 'paused error');
      const have = fs.statSync(d + '.part').size; assert(have > 0 && have < DATA.length, 'part kept ' + have);
      await dl.fetchResumable({ id: 't5', urls: [s.url], dest: d, expectBytes: DATA.length, sha256: SHA });
      assert(s.log[s.log.length - 1].range === `bytes=${have}-`, JSON.stringify(s.log));
      assert(shaOf(d) === SHA, 'hash');
    } finally { await s.close(); }
  });

  await test('sha256 不一致 → 删除并重新下载，并给出原因；持续不一致则报错', async () => {
    const s = await serve({ corruptFirst: true }); const d = path.join(tmp(), 'm.gguf'); const ev = [];
    try {
      const r = await dl.fetchResumable({ id: 't6', urls: [s.url], dest: d, expectBytes: DATA.length, sha256: SHA, onStatus: e => ev.push(e) });
      assert(r.redownloads === 1 && shaOf(d) === SHA, 'redownloaded');
      const vf = ev.find(e => e.state === 'verify-failed'); assert(vf && /sha256/.test(vf.reason), JSON.stringify(vf));
    } finally { await s.close(); }
    const s2 = await serve({ alwaysCorrupt: true }); const d2 = path.join(tmp(), 'm.gguf'); let err = null;
    try { await dl.fetchResumable({ id: 't6b', urls: [s2.url], dest: d2, expectBytes: DATA.length, sha256: SHA, redownloads: 1 }); } catch (e) { err = e; }
    finally { await s2.close(); }
    assert(err && err.verify && /sha256/.test(err.message) && !fs.existsSync(d2) && !fs.existsSync(d2 + '.part'), 'persistent mismatch: ' + (err && err.message));
  });

  await test('HTTP 5xx 退避重试后成功；404 立即失败（无无谓重试）', async () => {
    const s = await serve({ http500: 2 }); const d = path.join(tmp(), 'm.gguf');
    try { const r = await dl.fetchResumable({ id: 't7', urls: [s.url], dest: d, expectBytes: DATA.length, sha256: SHA }); assert(r.retries === 2 && shaOf(d) === SHA, 'retries ' + r.retries); } finally { await s.close(); }
    const s2 = http.createServer((q, r) => { r.statusCode = 404; r.end(); }); await new Promise(r => s2.listen(0, '127.0.0.1', r));
    let err = null; try { await dl.fetchResumable({ id: 't7b', urls: [`http://127.0.0.1:${s2.address().port}/x`], dest: path.join(tmp(), 'x'), expectBytes: 10 }); } catch (e) { err = e; } finally { s2.close(); }
    assert(err && /404/.test(err.message) && err.tried.length === 1, 'fatal 404: ' + (err && err.message));
  });

  await test('hub.download：MLX 多文件快照可恢复（local mock，AIB_HF_BASE）', async () => {
    const hub = require('../../src/main/ai/hub');
    const files = { 'config.json': Buffer.from('{"a":1}'), 'model.safetensors': crypto.randomBytes(400000), 'tokenizer.json': Buffer.from('{"t":1}') };
    let k = 0; const reqs = [];
    const srv = http.createServer((req, res) => {
      const f = decodeURIComponent(req.url.split('/resolve/main/')[1]); const b = files[f]; if (!b) { res.statusCode = 404; return res.end(); }
      // v3.0.0: the segmented downloader first probes Range support with bytes=0-0; this server has none (answers 200)
      if (req.headers.range === 'bytes=0-0') { res.writeHead(200, { 'content-length': b.length }); return res.end(b); }
      const m = (req.headers.range || '').match(/bytes=(\d+)-/); const st = m ? Number(m[1]) : 0; reqs.push(f + ':' + st);
      const body = b.subarray(st); res.writeHead(st ? 206 : 200, { 'content-length': body.length, ...(st ? { 'content-range': `bytes ${st}-${b.length - 1}/${b.length}` } : {}) });
      if (f === 'model.safetensors' && k++ === 0) { res.write(body.subarray(0, 100000)); return setTimeout(() => res.socket.destroy(), 20); }
      res.end(body);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    process.env.AIB_HF_BASE = `http://127.0.0.1:${srv.address().port}`;
    const dest = path.join(tmp(), 'mlx', 'x__y'); const ev = [];
    try {
      const snap = Object.entries(files).map(([file, b]) => ({ file, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') }));
      await hub.download({ id: 'mlx-test', engine: 'mlx', repo: 'x/y', bytes: 0, dest, snapshot: snap }, e => ev.push(e));
      assert(fs.existsSync(path.join(dest, '.aib-complete')), 'complete marker');
      assert(Buffer.compare(fs.readFileSync(path.join(dest, 'model.safetensors')), files['model.safetensors']) === 0, 'bytes equal');
      assert(reqs.filter(x => x.startsWith('model.safetensors')).length === 2 && reqs.some(x => /model.safetensors:\d{5,}/.test(x)), 'resumed the interrupted shard: ' + reqs.join());
      assert(ev.some(e => e.state === 'retrying') && ev[ev.length - 1].done, 'events');
    } finally { delete process.env.AIB_HF_BASE; srv.close(); }
  });
};
