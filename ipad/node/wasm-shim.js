'use strict';
// iOS: nodejs-mobile runs V8 without a JIT, so there is no WebAssembly. Node's fetch / Headers / Request / Response
// (undici) need it for their HTTP parser (llhttp), and the desktop main process uses Response for every aibrowser: page,
// so without this the app shows no window at all. polywasm (MIT, vendored as polywasm.js) runs WebAssembly as
// JavaScript. It has no SIMD: undici first tries its SIMD llhttp build and falls back to the plain build when compiling
// fails, so the SIMD build is rejected here (recognised by its SHA-256, or by the undici source of this Node build).
if (typeof globalThis.WebAssembly === 'undefined') {
  const W = require('./polywasm.js').WebAssembly;
  const crypto = require('crypto');
  const SIMD = new Set(['cd48aefa974e9fc21adec14ef0c73f0ad501b598078b12568ed129c320318154']); // Node 18.20.4 llhttp_simd
  try {
    const s = process.binding('natives')['internal/deps/undici/undici'] || '';
    const i = s.indexOf('var require_llhttp_simd_wasm');
    const m = i >= 0 && s.slice(i, i + 400000).match(/"([A-Za-z0-9+/=]{1000,})"/);
    if (m) SIMD.add(crypto.createHash('sha256').update(Buffer.from(m[1], 'base64')).digest('hex'));
  } catch {}
  const bytesOf = (b) => b instanceof ArrayBuffer ? new Uint8Array(b) : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : null;
  const isSimd = (b) => { const u = bytesOf(b); return !!u && SIMD.has(crypto.createHash('sha256').update(u).digest('hex')); };
  const compile = W.compile.bind(W);
  W.compile = async (b) => { if (isSimd(b)) throw new W.CompileError('WebAssembly SIMD is not available on this device'); return compile(b); };
  W.__aibPolyfill = true;
  globalThis.WebAssembly = W;
}
