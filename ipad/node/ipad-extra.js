'use strict';
// iPad-only additions to the desktop main process (loaded right after src/main/main.js).
const { ipcMain } = require('electron');
const os = require('os');
// Settings → About shows the iPad runtime (see the settings.js patch in scripts/build-ipad-bundle.js)
const prev = require('electron').__ipad.invokeHandlers.get('app:info');
if (prev) {
  ipcMain.removeHandler('app:info');
  ipcMain.handle('app:info', async (e, ...a) => Object.assign({}, await prev(e, ...a), { ipad: true, os: (global.__aibIpad && global.__aibIpad.os) || os.release(), node: process.versions.node }));
}
