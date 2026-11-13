'use strict';
// Checks the iPad payload against the device's JavaScript runtime limits, run with a Node 18 built like nodejs-mobile
// (`configure --with-intl=none`, `--jitless`): no Intl, TextDecoder limited to utf-8 / utf-16le, no WebAssembly JIT.
//   node --jitless scripts/check-ipad-runtime.js <bundle>/nodejs-project
// Loads the shims exactly as main-ipad.js does, decodes legacy encodings, then requires every main-process module
// so that a module-load-time dependency on ICU (or anything else missing on iOS) fails here instead of on the iPad.
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const NP = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'ipad-bundle', 'nodejs-project'));
const strict = process.argv.includes('--require-no-icu');
console.log('node', process.version, 'intl:', typeof Intl === 'undefined' ? 'none' : 'icu', 'jitless:', process.execArgv.includes('--jitless'));
if (strict) assert.strictEqual(typeof Intl, 'undefined', 'this check needs a Node built --with-intl=none');

require(path.join(NP, 'wasm-shim.js'));
require(path.join(NP, 'encoding-shim.js'));
const TD = globalThis.TextDecoder;
const dec = (enc, bytes, opts) => new TD(enc, opts).decode(Uint8Array.from(bytes));
const cases = [
  ['big5', [0xa4, 0xa4, 0xa4, 0xe5], '中文'], ['gb18030', [0xd6, 0xd0, 0xce, 0xc4], '中文'], ['gbk', [0xd6, 0xd0, 0xce, 0xc4], '中文'],
  ['gb2312', [0xd6, 0xd0, 0xce, 0xc4], '中文'], ['shift_jis', [0x93, 0xfa, 0x96, 0x7b], '日本'], ['euc-kr', [0xc7, 0xd1, 0xb1, 0xb9], '한국'],
  ['utf-16be', [0x4e, 0x2d, 0x65, 0x87], '中文'], ['windows-1252', [0x80, 0xe9], '€é'], ['latin1', [0xe9], 'é'], ['iso-8859-2', [0xb1], 'ą'],
  ['koi8-r', [0xe1], 'А'], ['utf-8', [0xe4, 0xb8, 0xad], '中'], ['utf-16le', [0x2d, 0x4e], '中'],
];
for (const [enc, b, want] of cases) assert.strictEqual(dec(enc, b), want, enc);
assert.strictEqual(new TD('BIG5').encoding, 'big5');
assert.strictEqual(require('util').TextDecoder, TD, 'util.TextDecoder patched');
// streaming: a GB18030 character split across chunks
{ const d = new TD('gb18030'); assert.strictEqual(d.decode(Uint8Array.of(0xd6), { stream: true }) + d.decode(Uint8Array.of(0xd0, 0xce), { stream: true }) + d.decode(Uint8Array.of(0xc4)), '中文'); }
// fatal utf-8 (rejected by a no-ICU Node unless shimmed), streamed and invalid
{ const d = new TD('utf-8', { fatal: true }); assert.strictEqual(d.decode(Uint8Array.of(0xe4, 0xb8), { stream: true }) + d.decode(Uint8Array.of(0xad)), '中');
  assert.throws(() => new TD('utf-8', { fatal: true }).decode(Uint8Array.of(0xff)), /not valid/); }
assert.throws(() => new TD('no-such-encoding'), (e) => e instanceof RangeError);
console.log('encodings ok:', cases.map(c => c[0]).join(' '));

// every module of the main process loads (no Electron app needed for require; side effects are guarded in the modules)
process.env.AIB_IPAD = '1';
const Module = require('module');
const errors = [];
const srcMain = path.join(NP, 'src', 'main');
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/node_modules|__pycache__/.test(e.name)) walk(p); } else if (e.name.endsWith('.js')) files.push(p); } })(srcMain);
const libs = ['js-mdict', 'jsdom', '@mozilla/readability', 'adm-zip', 'fzstd', 'iconv-lite'];
global.__aibIpad = global.__aibIpad || { userData: fs.mkdtempSync(path.join(require('os').tmpdir(), 'aib-chk-')), documents: '', appRoot: NP, tmp: require('os').tmpdir(), version: '0', resources: NP };
for (const l of libs) { try { Module.createRequire(path.join(NP, 'x.js'))(l); } catch (e) { errors.push(l + ': ' + (e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } }
const { MDX } = Module.createRequire(path.join(NP, 'x.js'))('js-mdict');
assert.strictEqual(typeof MDX, 'function', 'js-mdict MDX');
console.log('libraries ok:', libs.join(' '));
if (errors.length) { console.error('FAILED\n' + errors.join('\n')); process.exit(1); }
console.log('ipad runtime check passed (' + files.length + ' main-process files present)');
