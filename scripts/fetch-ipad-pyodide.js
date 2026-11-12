#!/usr/bin/env node
'use strict';
// Adds Pyodide (CPython on WebAssembly) to the iPad payload: <payload>/pyodide (runtime + the bundled scientific
// packages and their dependencies) and <payload>/pyodide-packages.json. Same Pyodide version as the web app.
// usage: node scripts/fetch-ipad-pyodide.js <payload> [--cache <dir>]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'ipad', 'build', 'payload'));
const ci = process.argv.indexOf('--cache');
const CACHE = path.resolve(ci > 0 ? process.argv[ci + 1] : path.join(require('os').tmpdir(), 'aib-pyodide-cache'));
const VERSION = /PYODIDE_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'web', 'js', 'python-worker.js'), 'utf8'))[1];
const WANT = ['micropip', 'numpy', 'scipy', 'sympy', 'mpmath', 'pandas', 'matplotlib', 'pillow', 'packaging'];

fs.mkdirSync(CACHE, { recursive: true });
const tarball = path.join(CACHE, `pyodide-${VERSION}.tar.bz2`);
if (!fs.existsSync(tarball)) {
  const url = `https://github.com/pyodide/pyodide/releases/download/${VERSION}/pyodide-${VERSION}.tar.bz2`;
  console.log('downloading', url);
  execFileSync('curl', ['-fL', '--retry', '3', '-o', tarball + '.part', url], { stdio: 'inherit' });
  fs.renameSync(tarball + '.part', tarball);
}
const ex = path.join(CACHE, `x-${VERSION}`);
if (!fs.existsSync(path.join(ex, 'pyodide', 'pyodide-lock.json'))) {
  fs.rmSync(ex, { recursive: true, force: true }); fs.mkdirSync(ex, { recursive: true });
  try { execFileSync('tar', ['-xjf', tarball, '-C', ex], { stdio: 'inherit' }); }
  catch (e) { execFileSync('python3', ['-c', 'import sys,tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2])', tarball, ex], { stdio: 'inherit' }); } // no bzip2 binary
}
const SRC = path.join(ex, 'pyodide');
const lock = JSON.parse(fs.readFileSync(path.join(SRC, 'pyodide-lock.json'), 'utf8'));
const pk = lock.packages;
const norm = (n) => String(n).toLowerCase().replace(/[-_.]+/g, '-');
const byName = new Map(Object.entries(pk).map(([k, v]) => [norm(k), v]));
const need = new Set();
const visit = (n) => { const k = norm(n); if (need.has(k)) return; const p = byName.get(k); if (!p) throw new Error('not in Pyodide ' + VERSION + ': ' + n); need.add(k); for (const d of p.depends || []) visit(d); };
WANT.forEach(visit);

const DST = path.join(OUT, 'pyodide');
if (!fs.existsSync(path.join(SRC, 'python_stdlib.zip'))) throw new Error('python_stdlib.zip missing from the Pyodide distribution');
fs.rmSync(DST, { recursive: true, force: true }); fs.mkdirSync(DST, { recursive: true });
// runtime files (everything that is not a package archive)
// (python_stdlib.zip is runtime; package archives, *-tests.zip, metadata, CLI launchers, maps and typings are not)
const pkgFiles = new Set(Object.values(pk).map(p => p.file_name));
const SKIP = /\.(metadata|map|d\.ts|bat|exe)$|-tests\.zip$|^python$|^python_cli_entry\.mjs$|^console.*\.html$/;
for (const f of fs.readdirSync(SRC)) {
  if (pkgFiles.has(f) || SKIP.test(f) || (/\.(zip|whl|tar|tgz)$/.test(f) && f !== 'python_stdlib.zip')) continue;
  const s = path.join(SRC, f); if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(DST, f));
}
let bytes = 0; const list = [];
for (const k of need) {
  const p = byName.get(k);
  fs.copyFileSync(path.join(SRC, p.file_name), path.join(DST, p.file_name));
  bytes += fs.statSync(path.join(DST, p.file_name)).size;
  list.push({ name: p.name, version: p.version });
}
list.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(OUT, 'pyodide-packages.json'), JSON.stringify({ pyodide: VERSION, python: lock.info && lock.info.python, packages: list }, null, 1));
for (const f of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) if (!fs.existsSync(path.join(DST, f))) throw new Error('runtime file missing: ' + f);
console.log(`pyodide ${VERSION} (Python ${lock.info && lock.info.python}): ${list.length} packages, ${(bytes / 1048576).toFixed(1)} MB -> ${DST}`);
