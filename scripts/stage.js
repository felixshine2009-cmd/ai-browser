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

const TARGETS = {
  'mac-arm64': { os: 'darwin', cpu: 'arm64', keep: ['mac-arm64-metal'] },
  'win-x64': { os: 'win32', cpu: 'x64', keep: ['win-x64', 'win-x64-vulkan'] },
  'win-arm64': { os: 'win32', cpu: 'arm64', keep: ['win-arm64'] }
};

function stage(target = 'mac-arm64') {
  const T = TARGETS[target]; if (!T) throw new Error('unknown target ' + target);
  fs.rmSync(path.join(ROOT, 'dist', '.stage'), { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  delete pkg.devDependencies; delete pkg.scripts;
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(pkg, null, 2));
  copy('src'); copy('extensions'); copy('docs');
  // bundled GGUF: EmbeddingGemma only (knowledge base). HY-MT1.5 is downloaded on first translation (hf-mirror, resumable). Symlinks are dereferenced.
  const md = path.join(ROOT, 'models');
  if (fs.existsSync(md)) { fs.mkdirSync(path.join(STAGE, 'models'), { recursive: true }); for (const f of fs.readdirSync(md)) if (/\.gguf$/.test(f) && !/^HY-MT/i.test(f))  /* HY-MT translation model is NOT bundled: downloaded on first translation */ fs.copyFileSync(fs.realpathSync(path.join(md, f)), path.join(STAGE, 'models', f)); }
  // resolve with the same lockfile (ignoring devDependencies), but for the target OS/CPU
  fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(STAGE, 'package-lock.json'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--os=' + T.os, '--cpu=' + T.cpu, '--force'], { cwd: STAGE, stdio: 'inherit' });
  const nl = path.join(STAGE, 'node_modules', '@node-llama-cpp');
  const have = fs.existsSync(nl) ? fs.readdirSync(nl) : [];
  if (!have.includes(T.keep[0])) throw new Error(T.keep[0] + ' binary package missing from stage (have: ' + have.join(',') + ')');
  for (const d of have) if (!T.keep.includes(d)) fs.rmSync(path.join(nl, d), { recursive: true, force: true });
  // drop dev-only / huge unused bits
  for (const d of ['node_modules/.package-lock.json']) fs.rmSync(path.join(STAGE, d), { force: true });
  // embedded CPython + scientific libraries + vfkit (Apple Silicon only)
  if (target === 'mac-arm64' && !process.env.AIB_SKIP_RUNTIME) execFileSync('python3', [path.join(__dirname, 'stage-runtime.py'), STAGE], { stdio: 'inherit' });
  console.log('staged', STAGE, 'node-llama-cpp natives:', fs.readdirSync(nl));
  return STAGE;
}

module.exports = { stage, STAGE, TARGETS };
if (require.main === module) stage(process.argv[2] || 'mac-arm64');
