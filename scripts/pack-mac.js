'use strict';
// npm run dist:mac  →  dist/AI-Browser-mac-arm64.zip (unsigned .app), dist/AI-Browser-source.zip, install scripts, README
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { stage } = require('./stage-mac');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const APP_NAME = 'AI Browser';

function zipDir(dir, out, keepParent) {
  fs.rmSync(out, { force: true });
  if (process.platform === 'darwin') {
    execFileSync('ditto', ['-c', '-k', ...(keepParent ? ['--keepParent'] : []), '--sequesterRsrc', dir, out], { stdio: 'inherit' });
  } else {
    execFileSync('python3', [path.join(__dirname, 'zipdir.py'), dir, out, ...(keepParent ? ['--keep-parent'] : [])], { stdio: 'inherit' });
  }
}

(async () => {
  const packager = require('@electron/packager');
  const stageDir = stage();
  const out = path.join(DIST, '.build');
  fs.rmSync(out, { recursive: true, force: true });
  const electronVersion = require('electron/package.json').version;
  const paths = await packager({
    dir: stageDir, out, name: APP_NAME, platform: 'darwin', arch: 'arm64', electronVersion,
    asar: false, prune: false, overwrite: true, appBundleId: 'com.felix.aibrowser', appCategoryType: 'public.app-category.productivity',
    appVersion: require('../package.json').version,
    extendInfo: { CFBundleDisplayName: 'AI浏览器', LSMinimumSystemVersion: '12.0' },
    // electron's own prebuilt (ad-hoc signed) bundle; re-signing happens on the Mac in install.command
    icon: path.join(ROOT, 'build', 'icon.icns'),
    osxSign: false, quiet: false
  });
  const appDir = path.join(paths[0], APP_NAME + '.app');
  if (!fs.existsSync(appDir)) throw new Error('app bundle not produced: ' + paths[0]);
  const zip = path.join(DIST, 'AI-Browser-mac-arm64.zip');
  zipDir(appDir, zip, true);
  console.log('wrote', zip, (fs.statSync(zip).size / 1048576).toFixed(1) + ' MB');
  // NOTE: no .dmg is published (Felix removed it); make-dmg.py stays available for manual use.

  // source zip (no node_modules / dist)
  // (copy into the OS temp dir: copying a project into its own subdirectory is an error)
  const tmpRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aib-src-'));
  const srcStage = path.join(tmpRoot, 'ai-browser');
  fs.mkdirSync(srcStage, { recursive: true });
  const skip = new Set(['node_modules', 'dist', '.git', '.DS_Store', 'models', 'shots', 'vendor-cache', 'test-results', '__pycache__']);
  // local test output (ignored by git) stays out of the source zip
  const skipRel = new Set([path.join('test', 'results.json')]);
  fs.cpSync(ROOT, srcStage, { recursive: true, filter: (s) => !skip.has(path.basename(s)) && !skipRel.has(path.relative(ROOT, s)) });
  const sz = path.join(DIST, 'AI-Browser-source.zip');
  zipDir(srcStage, sz, true);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log('wrote', sz, (fs.statSync(sz).size / 1048576).toFixed(1) + ' MB');

  for (const f of ['install.command', 'install.sh', 'README.md', 'README_zh.md']) {
    const src = [path.join(ROOT, 'installer', f), path.join(ROOT, f)].find(fs.existsSync);
    if (src) { fs.copyFileSync(src, path.join(DIST, f === 'README_zh.md' ? 'README-zh.md' : f)); if (f.startsWith('install')) fs.chmodSync(path.join(DIST, f), 0o755); }
  }
  fs.rmSync(path.join(DIST, '.stage'), { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
  console.log('done →', DIST);
})().catch(e => { console.error(e); process.exit(1); });
