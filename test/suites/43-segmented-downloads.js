'use strict';
// v3.0.0 — multi-connection (segmented) model downloads in dl.js: Felix measured only a few hundred KB/s from one
// connection to hf-mirror, so large files are now fetched over 8 parallel Range segments that resume independently.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
process.env.AIB_DL_BACKOFF_MS = '15'; process.env.AIB_DL_BACKOFF_MAX_MS = '60';
const dl = require('../../src/main/ai/dl');

const SIZE = 6 * 1024 * 1024 + 4321;
const DATA = crypto.randomBytes(SIZE);
const SHA = crypto.createHash('sha256').update(DATA).digest('hex');

// per-connection throttled server with full Range support (bytes=a-b)
function serve(opt = {}) {
  const log = []; let live = 0, maxLive = 0, sent = 0, n = 0;
  const srv = http.createServer((req, res) => {
    const i = n++;
    const m = (req.headers.range || '').match(/bytes=(\d+)-(\d*)/);
    let a = 0, b = SIZE - 1; if (m && !opt.ignoreRange) { a = Number(m[1]); if (m[2]) b = Math.min(SIZE - 1, Number(m[2])); }
    log.push({ i, range: req.headers.range || '', a, b });
    if (opt.fail && opt.fail(i, a)) { res.statusCode = 500; return res.end('x'); }
    const partial = !!m && !opt.ignoreRange;
    res.writeHead(partial ? 206 : 200, { 'content-length': b - a + 1, 'accept-ranges': 'bytes', ...(partial ? { 'content-range': `bytes ${a}-${b}/${SIZE}` } : {}) });
    live++; maxLive = Math.max(maxLive, live); res.on('close', () => { live--; });
    let pos = a; const CH = opt.chunk || 32 * 1024; let stalled = false;
    const pump = () => {
      if (res.destroyed) return;
      if (pos > b) return res.end();
      if (opt.stallOnce && !opt._stalled && a > 0 && pos - a > 64 * 1024) { opt._stalled = true; stalled = true; return; } // hang without closing
      const end = Math.min(b + 1, pos + CH); const slice = DATA.subarray(pos, end); pos = end; sent += slice.length;
      const d = typeof opt.delay === 'function' ? opt.delay(a) : (opt.delay || 0);
      res.write(slice, () => setTimeout(pump, d));
    };
    pump();
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, log, stats: () => ({ maxLive, sent }), url: `http://127.0.0.1:${srv.address().port}/m.gguf`, close: () => new Promise(c => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(c); }) })));
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aib-seg-'));
const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const SEG = { segMinBytes: 1024 * 1024, minSplitBytes: 128 * 1024 };

module.exports = async ({ test, group, assert, eq }) => {
  group('多连接分段下载（v3.0.0，mock HTTP）');

  await test('大文件用 8 个并行 Range 分段下载，结果 sha256 正确，比单连接明显更快', async () => {
    const s1 = await serve({ delay: 8 }); const d1 = path.join(tmp(), 'm.gguf');
    const t0 = Date.now();
    try { await dl.fetchResumable({ id: 'single', urls: [s1.url], dest: d1, expectBytes: SIZE, sha256: SHA, segments: 1 }); } finally { await s1.close(); }
    const single = Date.now() - t0;
    const s = await serve({ delay: 8 }); const d = path.join(tmp(), 'm.gguf'); const ev = [];
    const t1 = Date.now();
    try {
      const r = await dl.fetchResumable(Object.assign({ id: 'seg', urls: [s.url], dest: d, expectBytes: SIZE, sha256: SHA, onStatus: e => ev.push(e) }, SEG));
      const multi = Date.now() - t1;
      eq(shaOf(d), SHA); assert(r.segments, 'segmented');
      assert(s.stats().maxLive >= 6, 'parallel connections: ' + s.stats().maxLive);
      assert(s.log.filter(x => /^bytes=\d+-\d+$/.test(x.range)).length >= 8, 'ranged requests ' + s.log.length);
      assert(multi < single * 0.5, `faster: ${multi} ms vs single ${single} ms`);
      assert(ev.some(e => e.state === 'downloading' && e.conns >= 6), 'progress reports connections');
      const gots = ev.filter(e => e.state === 'downloading').map(e => e.got);
      assert(gots.every((g, i) => i === 0 || g >= gots[i - 1]) && gots[gots.length - 1] <= SIZE, 'monotonic progress');
      assert(!fs.existsSync(d + '.part') && !fs.existsSync(d + '.part.json'), 'cleanup');
      assert(s.stats().sent <= SIZE * 1.05 + 64 * 1024, 'no duplicate bytes: ' + s.stats().sent);
    } finally { await s.close(); }
  });

  await test('暂停后每个分段从各自的位置继续（不重复下载已完成部分）；进度按实际字节计算', async () => {
    const s = await serve({ delay: 60 }); const d = path.join(tmp(), 'm.gguf'); const ac = new AbortController(); let paused = false;
    try {
      const p = dl.fetchResumable(Object.assign({ id: 'p', urls: [s.url], dest: d, expectBytes: SIZE, sha256: SHA, signal: ac.signal }, SEG));
      const iv = setInterval(() => { if (dl.partialBytes(d) > SIZE / 3) { clearInterval(iv); ac.abort('pause'); } }, 5);
      try { await p; } catch (e) { paused = !!e.paused; }
      assert(paused, 'paused');
      eq(fs.statSync(d + '.part').size, SIZE, 'preallocated part');
      const have = dl.partialBytes(d); assert(have > SIZE / 4 && have < SIZE * 0.9, 'partial bytes ' + have);
      const meta = JSON.parse(fs.readFileSync(d + '.part.json', 'utf8')); assert(Array.isArray(meta.segs) && meta.segs.length >= 8, 'segments saved');
      const before = s.stats().sent, n0 = s.log.length;
      await dl.fetchResumable(Object.assign({ id: 'p', urls: [s.url], dest: d, expectBytes: SIZE, sha256: SHA }, SEG));
      eq(shaOf(d), SHA);
      const resumed = s.log.slice(n0);
      assert(resumed.every(x => /^bytes=\d+-\d+$/.test(x.range)), 'only ranged requests after resume (no probe, no restart)');
      assert(resumed.some(x => meta.segs.every(g => g.s !== x.a)), 'some segments continue mid-way');
      assert(s.stats().sent - before <= SIZE - have + 8 * 64 * 1024, `resume downloaded ${s.stats().sent - before}, remaining ${SIZE - have}`);
    } finally { await s.close(); }
  });

  await test('某个连接卡住（不再发送数据）→ 超时后丢弃该连接并重试，下载完成', async () => {
    const s = await serve({ delay: 2, stallOnce: true }); const d = path.join(tmp(), 'm.gguf'); const ev = [];
    try {
      const r = await dl.fetchResumable(Object.assign({ id: 'st', urls: [s.url], dest: d, expectBytes: SIZE, sha256: SHA, stallMs: 400, onStatus: e => ev.push(e) }, SEG));
      eq(shaOf(d), SHA); assert(r.retries >= 1, 'retried ' + r.retries);
      assert(ev.some(e => e.state === 'retrying' && /stalled/.test(e.error)), 'stall reported');
    } finally { await s.close(); }
  });

  await test('空闲连接会拆分最慢的分段（慢连接不拖累整体）', async () => {
    // the connection for the first segment is 20× slower than the others
    const s = await serve({ delay: (a) => (a === 0 ? 40 : 2) }); const d = path.join(tmp(), 'm.gguf');
    const t0 = Date.now();
    try {
      await dl.fetchResumable(Object.assign({ id: 'ws', urls: [s.url], dest: d, expectBytes: SIZE, sha256: SHA }, SEG));
      eq(shaOf(d), SHA);
      assert(s.log.length > 9, 'segments were split: ' + s.log.length + ' requests');
      // first segment alone at 32 KB / 40 ms would take ~ (SIZE/8)/32K*40 ms ≈ 960 ms
      assert(Date.now() - t0 < 900, 'finished in ' + (Date.now() - t0) + ' ms');
    } finally { await s.close(); }
  });

  await test('服务器不支持 Range → 回退为单连接下载；源失败时分段切换到其他镜像', async () => {
    const s = await serve({ ignoreRange: true }); const d = path.join(tmp(), 'm.gguf');
    try {
      const r = await dl.fetchResumable(Object.assign({ id: 'nr', urls: [s.url], dest: d, expectBytes: SIZE, sha256: SHA }, SEG));
      eq(shaOf(d), SHA); assert(!r.segments, 'single stream');
    } finally { await s.close(); }
    // the first mirror fails every data request (but answers the probe): all segments move to the second mirror
    const bad = await serve({ fail: (i) => i > 0 }); const good = await serve({ delay: 1 }); const d2 = path.join(tmp(), 'm.gguf');
    try {
      const r = await dl.fetchResumable(Object.assign({ id: 'mir', urls: [bad.url, good.url], dest: d2, expectBytes: SIZE, sha256: SHA }, SEG));
      eq(shaOf(d2), SHA); assert(r.segments && good.log.length >= 1, 'served by the mirror');
    } finally { await bad.close(); await good.close(); }
  });

  await test('分段下载的 sha256 不一致 → 删除后重新下载', async () => {
    let first = true;
    const s = await serve({ delay: 1 });
    const d = path.join(tmp(), 'm.gguf'); const ev = [];
    // corrupt the finished part once, right before verification
    const orig = dl.sha256File;
    try {
      const r = await dl.fetchResumable(Object.assign({ id: 'vf', urls: [s.url], dest: d, expectBytes: SIZE, sha256: SHA, onStatus: (e) => { ev.push(e.state); if (e.state === 'verifying' && first) { first = false; const fd = fs.openSync(d + '.part', 'r+'); fs.writeSync(fd, Buffer.from([DATA[10] ^ 0xff]), 0, 1, 10); fs.closeSync(fd); } } }, SEG));
      eq(shaOf(d), SHA); eq(r.redownloads, 1); assert(ev.includes('verify-failed'), ev.join());
    } finally { await s.close(); void orig; }
  });

  group('模型下载源：魔搭 ModelScope + 自动测速排序');
  await test('默认“自动”：魔搭排在最前，其后 hf-mirror / huggingface.co；魔搭地址格式与仓库名映射', () => {
    const hub = require('../../src/main/ai/hub');
    eq(hub.hubCfg().endpoint, 'auto'); eq(hub.hubCfg().connections, 8);
    const src = hub.sources(); eq(src.map(x => x.id), ['modelscope', 'mirror', 'official']);
    eq(hub.sourceUrl(src[0], 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', 'qwen2.5-0.5b-instruct-q4_k_m.gguf'), 'https://modelscope.cn/models/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/master/qwen2.5-0.5b-instruct-q4_k_m.gguf');
    eq(hub.sourceUrl(src[1], 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', 'a.gguf'), 'https://hf-mirror.com/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/a.gguf');
    eq(hub.msRepo('tencent/HY-MT1.5-1.8B-GGUF'), 'Tencent-Hunyuan/HY-MT1.5-1.8B-GGUF');
  });
  await test('测速排序：最快的源排第一，不存在该文件（404）的源被排除', async () => {
    const hub = require('../../src/main/ai/hub');
    const slow = await serve({ delay: 40, chunk: 16 * 1024 }), fast = await serve({ delay: 0 });
    const nf = http.createServer((q, r) => { r.statusCode = 404; r.end(); }); await new Promise(r => nf.listen(0, '127.0.0.1', r));
    const nfu = `http://127.0.0.1:${nf.address().port}/m.gguf`;
    try {
      const r = await hub.rankUrls([slow.url, nfu, fast.url], { bytes: 256 * 1024, ms: 3000 });
      eq(r.urls, [fast.url, slow.url]);
    } finally { await slow.close(); await fast.close(); nf.close(); }
  });
};
