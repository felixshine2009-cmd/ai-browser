'use strict';
// npm run dist:win  [x64|arm64]  →  dist/AI-Browser-win-<arch>-setup.exe (NSIS) + dist/AI-Browser-win-<arch>-portable.zip
// Runs on Linux/macOS/Windows without wine and without code signing:
//  - @electron/packager builds the unpacked app (no rcedit, so no wine),
//  - the exe icon + version info are patched with `resedit` (pure JS),
//  - electron-builder wraps the prepackaged folder into an NSIS installer (signAndEditExecutable:false).
// Electron binaries come from npmmirror unless ELECTRON_MIRROR is already set.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { stage } = require('./stage');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const APP_NAME = 'AI Browser';
const arch = process.argv[2] === 'arm64' ? 'arm64' : 'x64';
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';


function dirSize(d) { let t = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); t += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } return t; }

// makensis: AIB_MAKENSIS (+ NSISDIR), a system install, or the copy electron-builder caches (~/.cache/electron-builder/nsis/nsis-*/linux/makensis).
function findMakensis() {
  if (process.env.AIB_MAKENSIS) return { bin: process.env.AIB_MAKENSIS, dir: process.env.NSISDIR || path.dirname(process.env.AIB_MAKENSIS) };
  const home = require('os').homedir();
  const roots = [path.join(home, '.cache', 'electron-builder', 'nsis'), path.join(home, 'Library', 'Caches', 'electron-builder', 'nsis'), path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis')];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter(n => /^nsis-\d/.test(n))) {
      const sub = process.platform === 'win32' ? 'Bin/makensis.exe' : process.platform === 'darwin' ? 'mac/makensis' : 'linux/makensis';
      const bin = path.join(r, d, sub); if (fs.existsSync(bin)) return { bin, dir: path.join(r, d) };
    }
  }
  throw new Error('makensis not found. Set AIB_MAKENSIS (and NSISDIR), or run `npx electron-builder --win nsis` once so it caches NSIS.');
}

function nsiScript({ arch, version, appDir, out, ico, bytes }) {
  const q = (p) => '"' + p.replace(/"/g, '$\\"') + '"';
  const kb = Math.round(bytes / 1024);
  return `Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
Name "AI Browser"
OutFile ${q(out)}
InstallDir "$LOCALAPPDATA\\Programs\\AI Browser"
InstallDirRegKey HKCU "Software\\AIBrowser" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "AI Browser ${version} - Created by Grok"
VIProductVersion "${version}.0"
VIAddVersionKey "ProductName" "AI Browser"
VIAddVersionKey "FileDescription" "AI Browser installer"
VIAddVersionKey "FileVersion" "${version}"
VIAddVersionKey "LegalCopyright" "Created by Grok"
!define MUI_ICON ${q(ico)}
!define MUI_UNICON ${q(ico)}
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\\AI Browser.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
Section "AI Browser" SecMain
  SetOutPath "$INSTDIR"
  File /r ${q(appDir + '/*.*')}
  WriteUninstaller "$INSTDIR\\Uninstall AI Browser.exe"
  WriteRegStr HKCU "Software\\AIBrowser" "InstallDir" "$INSTDIR"
  CreateShortCut "$SMPROGRAMS\\AI Browser.lnk" "$INSTDIR\\AI Browser.exe"
  CreateShortCut "$DESKTOP\\AI Browser.lnk" "$INSTDIR\\AI Browser.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AIBrowser" "DisplayName" "AI Browser"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AIBrowser" "DisplayVersion" "${version}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AIBrowser" "Publisher" "Felix"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AIBrowser" "DisplayIcon" "$INSTDIR\\AI Browser.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AIBrowser" "UninstallString" '"$INSTDIR\\Uninstall AI Browser.exe"'
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AIBrowser" "EstimatedSize" ${kb}
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AIBrowser" "NoModify" 1
SectionEnd
Section "Uninstall"
  Delete "$SMPROGRAMS\\AI Browser.lnk"
  Delete "$DESKTOP\\AI Browser.lnk"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AIBrowser"
  DeleteRegKey HKCU "Software\\AIBrowser"
  RMDir /r "$INSTDIR"
SectionEnd
`;
}

function zipDir(dir, out) {
  fs.rmSync(out, { force: true });
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(__dirname, 'zipdir.py'), dir, out, '--keep-parent'], { stdio: 'inherit' });
}

function patchExe(exe, version) {
  const R = require('resedit');
  const bin = fs.readFileSync(exe);
  const ne = R.NtExecutable.from(bin);
  const res = R.NtExecutableResource.from(ne);
  const ico = R.Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'build', 'icon.ico')));
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
  const g = groups[0] || { id: 1, lang: 1033 };
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, ico.icons.map(i => i.data));
  const vis = R.Resource.VersionInfo.fromEntries(res.entries);
  const vi = vis[0] || R.Resource.VersionInfo.createEmpty();
  const [a, b, c] = String(version).split('.').map(n => parseInt(n, 10) || 0);
  vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: APP_NAME, ProductName: APP_NAME, CompanyName: 'Felix', InternalName: APP_NAME, OriginalFilename: APP_NAME + '.exe', LegalCopyright: 'Created by Grok' });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(ne);
  fs.writeFileSync(exe, Buffer.from(ne.generate()));
}

(async () => {
  const packager = require('@electron/packager');
  const version = require('../package.json').version;
  const stageDir = stage('win-' + arch);
  const out = path.join(DIST, '.build-win-' + arch);
  fs.rmSync(out, { recursive: true, force: true });
  const paths = await packager({
    dir: stageDir, out, name: APP_NAME, platform: 'win32', arch, electronVersion: require('electron/package.json').version,
    asar: false, prune: false, overwrite: true, quiet: false
  });
  const appDir = paths[0];
  const exe = path.join(appDir, APP_NAME + '.exe');
  if (!fs.existsSync(exe)) throw new Error('exe not produced in ' + appDir);
  patchExe(exe, version);
  fs.mkdirSync(DIST, { recursive: true });
  const zip = path.join(DIST, `AI-Browser-win-${arch}-portable.zip`);
  zipDir(appDir, zip);
  console.log('wrote', zip, (fs.statSync(zip).size / 1048576).toFixed(1) + ' MB');

  // NSIS installer (wizard: choose folder, per-user install, desktop + Start-menu shortcuts, uninstaller).
  // Built with makensis directly (electron-builder's NSIS path needs wine on Linux just to emit the uninstaller; a plain WriteUninstaller does not).
  const exeOut = path.join(DIST, `AI-Browser-win-${arch}-setup.exe`);
  fs.rmSync(exeOut, { force: true });
  const nsi = path.join(DIST, `.installer-${arch}.nsi`);
  const bs = (p) => p.replace(/\//g, '\\');
  const ico = path.join(ROOT, 'build', 'icon.ico');
  fs.writeFileSync(nsi, nsiScript({ arch, version, appDir: process.platform === 'win32' ? appDir : appDir, out: exeOut, ico, bytes: dirSize(appDir) }));
  const mk = findMakensis();
  execFileSync(mk.bin, ['-V2', nsi], { stdio: 'inherit', env: { ...process.env, NSISDIR: mk.dir } });
  fs.rmSync(nsi, { force: true });
  if (!fs.existsSync(exeOut)) throw new Error('installer not produced');
  console.log('wrote', exeOut, (fs.statSync(exeOut).size / 1048576).toFixed(1) + ' MB');
  fs.rmSync(path.join(DIST, '.stage'), { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
