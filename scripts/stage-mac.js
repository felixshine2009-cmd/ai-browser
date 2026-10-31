'use strict';
// Stage a production-only copy of the app for macOS arm64:
//   dist/.stage/app/{package.json,src,extensions,docs,node_modules(darwin-arm64 natives)}
// npm is told to resolve optional native packages for darwin/arm64 (node-llama-cpp Metal binary etc.), so the
// staging can run on any OS (we build on Linux) and the result is correct for an M1/M2/M3 Mac.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, 'dist', '.stage', 'app');

function copy(rel, filter) {
  fs.cpSync(path.join(ROOT, rel), path.join(STAGE, rel), { recursive: true, filter });
}

function stage() {
  fs.rmSync(path.join(ROOT, 'dist', '.stage'), { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  delete pkg.devDependencies; delete pkg.scripts;
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(pkg, null, 2));
  copy('src'); copy('extensions'); copy('docs');
  // bundled GGUF models (EmbeddingGemma for the knowledge base, HY-MT1.5 for translation); symlinks are dereferenced
  const md = path.join(ROOT, 'models');
  if (fs.existsSync(md)) { fs.mkdirSync(path.join(STAGE, 'models'), { recursive: true }); for (const f of fs.readdirSync(md)) if (/\.gguf$/.test(f)) fs.copyFileSync(fs.realpathSync(path.join(md, f)), path.join(STAGE, 'models', f)); }
  // resolve with the same lockfile (ignoring devDependencies), but for darwin/arm64
  fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(STAGE, 'package-lock.json'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--os=darwin', '--cpu=arm64', '--force'], { cwd: STAGE, stdio: 'inherit' });
  const nl = path.join(STAGE, 'node_modules', '@node-llama-cpp');
  const have = fs.existsSync(nl) ? fs.readdirSync(nl) : [];
  if (!have.includes('mac-arm64-metal')) throw new Error('mac-arm64-metal binary package missing from stage (have: ' + have.join(',') + ')');
  for (const d of have) if (d !== 'mac-arm64-metal') fs.rmSync(path.join(nl, d), { recursive: true, force: true });
  // drop dev-only / huge unused bits
  for (const d of ['node_modules/.package-lock.json']) fs.rmSync(path.join(STAGE, d), { force: true });
  console.log('staged', STAGE, 'node-llama-cpp natives:', fs.readdirSync(nl));
  return STAGE;
}

module.exports = { stage, STAGE };
if (require.main === module) stage();
