#!/usr/bin/env node
'use strict';
// Assemble the iPad app payload from the DESKTOP sources (the iPad app is a port of the desktop app, not of the PWA):
//   <out>/nodejs-project   desktop main process (src/main), renderer pages (src/renderer), preload, built-in
//                          extensions, production node_modules, plus the iPad layer from ipad/node:
//                          main-ipad.js (entry), host.js (native bridge), node_modules/electron (Electron API on iPad),
//                          node_modules/node-llama-cpp (llama.cpp bridge), module overrides (python, vm, mlx)
//   <out>/web              files the Swift host serves itself: inject/runtime.js (preload runtime with src/preload/preload.js
//                          inlined), inject/ipad.css, pyhost/, vmhost/
// usage: node scripts/build-ipad-bundle.js <out> [--no-npm]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'ipad-bundle'));
const NO_NPM = process.argv.includes('--no-npm');
const NP = path.join(OUT, 'nodejs-project');
const cp = (src, dst, filter) => fs.cpSync(src, dst, { recursive: true, dereference: true, filter });

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(NP, { recursive: true });

// ---- package.json: same version / deps as the desktop app; jsdom pinned to a Node 18 compatible major (nodejs-mobile = Node 18)
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
delete pkg.devDependencies; delete pkg.scripts; delete pkg.build;
pkg.main = 'main-ipad.js';
// Settings → About shows the iPad app version (ipad/project.yml MARKETING_VERSION), not the desktop version
{ const m = fs.readFileSync(path.join(ROOT, 'ipad', 'project.yml'), 'utf8').match(/MARKETING_VERSION:\s*"?([\d.]+)"?/); if (m) { pkg.desktopVersion = pkg.version; pkg.version = m[1]; } }
// iconv-lite: TextDecoder fallback for encodings nodejs-mobile (no ICU) lacks (ipad/node/encoding-shim.js)
pkg.dependencies = Object.assign({}, pkg.dependencies, { jsdom: '22.1.0', 'iconv-lite': '0.6.3' });
delete pkg.dependencies['node-llama-cpp'];
fs.writeFileSync(path.join(NP, 'package.json'), JSON.stringify(pkg, null, 2));

// ---- desktop sources
const skipPyc = (p) => !/__pycache__|\.pyc$/.test(p);
cp(path.join(ROOT, 'src'), path.join(NP, 'src'), skipPyc);
cp(path.join(ROOT, 'extensions'), path.join(NP, 'extensions'));

// ---- production dependencies (pure JavaScript only; native code lives in the Swift host)
if (!NO_NPM) {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: NP, stdio: 'inherit' });
  fs.rmSync(path.join(NP, 'node_modules', '.package-lock.json'), { force: true });
}

// ---- iPad layer
const IP = path.join(ROOT, 'ipad', 'node');
fs.copyFileSync(path.join(IP, 'main-ipad.js'), path.join(NP, 'main-ipad.js'));
fs.copyFileSync(path.join(IP, 'host.js'), path.join(NP, 'host.js'));
fs.copyFileSync(path.join(IP, 'ipad-extra.js'), path.join(NP, 'ipad-extra.js'));
for (const f of ['wasm-shim.js', 'polywasm.js', 'encoding-shim.js']) fs.copyFileSync(path.join(IP, f), path.join(NP, f));
for (const m of ['electron', 'node-llama-cpp']) { fs.rmSync(path.join(NP, 'node_modules', m), { recursive: true, force: true }); cp(path.join(IP, m), path.join(NP, 'node_modules', m)); }
// module overrides: platform services that iPadOS provides differently (no child processes, no Virtualization.framework)
cp(path.join(IP, 'overrides'), path.join(NP, 'src', 'main'));
// source patches that must apply cleanly (fails the build when the desktop code changed under them)
function patch(rel, pairs) {
  const f = path.join(NP, rel); let s = fs.readFileSync(f, 'utf8');
  for (const [re, to] of pairs) { if (!re.test(s)) throw new Error(`patch target not found in ${rel}: ${re}`); s = s.replace(re, to); }
  fs.writeFileSync(f, s);
}
// MLX is Apple's Mac-only machine-learning runtime (Python + Metal, needs a subprocess): not available on iPadOS.
patch('src/main/ai/mlx.js', [[/function platformOk\(\) \{[^\n]*\}/, "function platformOk() { return false; } // iPad: MLX (Mac-only) is not available"]]);
// Settings → About: show the iPad runtime instead of Electron / Chromium versions
patch('src/renderer/static/settings.js', [[/AI浏览器 \$\{esc\(info\.version\)\} · Electron \$\{esc\(info\.electron\)\} · Chromium \$\{esc\(info\.chromium\)\} · \$\{esc\(info\.platform\)\}\/\$\{esc\(info\.arch\)\}/,
  "AI浏览器 ${esc(info.version)} · ${info.ipad ? esc('iPadOS ' + (info.os || '') + ' · WebKit · Node.js ' + (info.node || '')) : 'Electron ' + esc(info.electron) + ' · Chromium ' + esc(info.chromium) + ' · ' + esc(info.platform) + '/' + esc(info.arch)}"]]);

// ---- web payload served by the Swift host (aibres://app/...)
const W = path.join(OUT, 'web');
cp(path.join(ROOT, 'ipad', 'web'), W);
const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.js'), 'utf8').replace(/^'use strict';\s*/, '').replace(/const \{ contextBridge, ipcRenderer \} = require\('electron'\);/, '');
const rt = fs.readFileSync(path.join(W, 'inject', 'runtime.js'), 'utf8');
if (rt.split('/*PRELOAD*/').length !== 2) throw new Error('runtime.js must contain the /*PRELOAD*/ marker exactly once');
// function replacement: the preload source contains "$" sequences that a replacement string would expand
const rtOut = rt.replace('/*PRELOAD*/', () => preload);
fs.writeFileSync(path.join(W, 'inject', 'runtime.js'), rtOut);
try { new Function(rtOut); } catch (e) { throw new Error('assembled runtime.js does not parse: ' + e.message); }

// ---- sanity checks
for (const f of ['main-ipad.js', 'src/main/main.js', 'src/renderer/pages/chrome.html', 'src/renderer/pages/home.html', 'node_modules/electron/index.js', 'node_modules/node-llama-cpp/index.js', 'encoding-shim.js'].concat(NO_NPM ? [] : ['node_modules/iconv-lite/package.json'])) {
  if (!fs.existsSync(path.join(NP, f))) throw new Error('missing in bundle: ' + f);
}
console.log('iPad bundle ready:', OUT);
