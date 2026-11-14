'use strict';
// iPad-only additions to the desktop main process (loaded right after src/main/main.js).
const { ipcMain } = require('electron');
const os = require('os');
// Settings → About shows the iPad runtime (see the settings.js patch in scripts/build-ipad-bundle.js)
// main.js registers its IPC handlers once the app is ready (after this file loads), so wrap app:info both if it is
// already registered and when it is registered later
const ipadInfo = (fn) => async (e, ...a) => Object.assign({}, await fn(e, ...a), { ipad: true, os: (global.__aibIpad && global.__aibIpad.os) || os.release(), node: process.versions.node });
const prev = require('electron').__ipad.invokeHandlers.get('app:info');
if (prev) { ipcMain.removeHandler('app:info'); ipcMain.handle('app:info', ipadInfo(prev)); }
else {
  const orig = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (ch, fn) => orig(ch, ch === 'app:info' ? ipadInfo(fn) : fn);
}
