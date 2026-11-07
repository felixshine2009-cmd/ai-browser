'use strict';
// MLX engine (Apple Silicon): lazily spawns `mlx_lm.server` (OpenAI-compatible) on a free localhost port and stops it
// after idle. Runtime lookup: $AIB_MLX_BIN -> <resources>/mlx/mlx_lm.server (bundled, if shipped) -> `mlx_lm.server` on PATH
// -> `python3 -m mlx_lm.server`. If MLX is unavailable or fails to start, callers fall back to llama.cpp with the reason.
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const store = require('../store');

const isEn = () => { try { return store.getSettings().lang === 'en'; } catch { return false; } };
const L = (zh, en) => (isEn() ? en : zh);
const servers = new Map(); // key -> {proc, port, model, ready, timer, lastUsed, idleMs}
let runtimeCache = null;

function platformOk() { return process.env.AIB_MLX_BIN ? true : (process.platform === 'darwin' && process.arch === 'arm64'); }
function which(cmd) { try { const r = spawnSync('which', [cmd], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.split('\n')[0].trim() : ''; } catch { return ''; } }
function detectRuntime(force) {
  if (runtimeCache && !force) return runtimeCache;
  let r;
  if (!platformOk()) r = { ok: false, reason: L('MLX 仅支持 Apple Silicon 的 macOS', 'MLX needs macOS on Apple Silicon') };
  else {
    const cands = [];
    if (process.env.AIB_MLX_BIN) cands.push({ cmd: process.env.AIB_MLX_BIN, args: [] });
    if (process.resourcesPath) cands.push({ cmd: path.join(process.resourcesPath, 'mlx', 'mlx_lm.server'), args: [] });
    const w = which('mlx_lm.server'); if (w) cands.push({ cmd: w, args: [] });
    const py = which('python3'); if (py) cands.push({ cmd: py, args: ['-m', 'mlx_lm.server'], probe: ['-c', 'import mlx_lm'] });
    for (const c of cands) {
      try {
        if (c.probe) { const p = spawnSync(c.cmd, c.probe, { timeout: 8000 }); if (p.status !== 0) continue; } else if (!fs.existsSync(c.cmd)) continue;
        r = { ok: true, ...c }; break;
      } catch {}
    }
    if (!r) r = { ok: false, reason: L('未找到 mlx-lm：请先在终端运行 pip3 install mlx-lm（或安装 oMLX 并在“本地框架”中使用）', 'mlx-lm not found: run `pip3 install mlx-lm` in Terminal (or install oMLX and use it under "Local frameworks")') };
  }
  runtimeCache = r; return r;
}
const available = () => detectRuntime().ok;

function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
async function waitReady(port, proc, timeoutMs) {
  const t0 = Date.now(); let stderr = '';
  if (proc.stderr) proc.stderr.on('data', d => { stderr = (stderr + d).slice(-600); });
  while (Date.now() - t0 < timeoutMs) {
    if (proc.exitCode != null) throw new Error(L('MLX 服务启动失败：', 'MLX server exited: ') + (stderr.trim().split('\n').pop() || 'exit ' + proc.exitCode));
    try { const r = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(L('MLX 服务启动超时（首次加载模型可能较慢）', 'MLX server start timed out (first model load can be slow)'));
}

// acquire a running server for `model` (a local dir or HF repo id). key separates chat from translate instances.
async function acquire(model, { key = 'chat', idleMs = 600000 } = {}) {
  const rt = detectRuntime(); if (!rt.ok) throw new Error(rt.reason);
  let s = servers.get(key);
  if (s && s.model !== model) { await stop(key); s = null; }
  if (s && s.proc.exitCode != null) { servers.delete(key); s = null; }
  if (!s) {
    const port = await freePort();
    const mtpArgs = require('../v36/mtp').extraArgs(model);
    const proc = spawn(rt.cmd, [...rt.args, '--model', model, ...mtpArgs, '--host', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    s = { proc, port, model, ready: null, idleMs, lastUsed: Date.now() };
    s.ready = waitReady(port, proc, Number(process.env.AIB_MLX_START_TIMEOUT_MS) || 180000).catch(e => { try { proc.kill(); } catch {} servers.delete(key); throw e; });
    servers.set(key, s);
  }
  await s.ready;
  s.lastUsed = Date.now(); s.idleMs = idleMs; clearTimeout(s.timer);
  return { baseUrl: `http://127.0.0.1:${s.port}/v1`, port: s.port, release() { s.lastUsed = Date.now(); clearTimeout(s.timer); s.timer = setTimeout(() => stop(key), Number(process.env.AIB_MLX_IDLE_MS) || s.idleMs); if (s.timer.unref) s.timer.unref(); } };
}
async function stop(key) {
  const s = servers.get(key); if (!s) return; servers.delete(key); clearTimeout(s.timer);
  try { s.proc.kill('SIGTERM'); } catch {}
  await new Promise(r => { const t = setTimeout(() => { try { s.proc.kill('SIGKILL'); } catch {} r(); }, 3000); s.proc.once('exit', () => { clearTimeout(t); r(); }); });
}
async function stopAll() { for (const k of Array.from(servers.keys())) await stop(k); }
const status = () => ({ platformOk: platformOk(), available: available(), runtime: detectRuntime(), running: Array.from(servers.entries()).map(([k, s]) => ({ key: k, model: s.model, port: s.port, lastUsed: s.lastUsed })) });

module.exports = { acquire, stop, stopAll, available, detectRuntime, status, platformOk };
