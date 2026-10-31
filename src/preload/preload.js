'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['tabs:state', 'settings:changed', 'chat:event', 'panel:call', 'downloads:changed', 'history:changed',
  'bookmarks:changed', 'ext:changed', 'lm:progress', 'find:result', 'find:focus', 'addr:focus', 'overlay:leave']);

if (location.protocol === 'aibrowser:') {
  // Internal pages only: privileged bridge (main re-checks sender URL on every call).
  contextBridge.exposeInMainWorld('aib', {
    invoke: (channel, ...args) => {
      if (!/^[a-z]+:[A-Za-z]+$/.test(channel)) return Promise.reject(new Error('bad channel'));
      return ipcRenderer.invoke(channel, ...args);
    },
    on: (channel, cb) => {
      if (!EVENTS.has(channel)) return () => {};
      const h = (e, payload) => cb(payload);
      ipcRenderer.on(channel, h);
      return () => ipcRenderer.removeListener(channel, h);
    },
    platform: process.platform
  });
} else if (/^https?:$/.test(location.protocol)) {
  // Ordinary web pages: selection lookup trigger only. No API is exposed to the page.
  let timer = null;
  const WORD = /^[A-Za-z][A-Za-z'’-]{1,40}$/;
  function report() {
    try {
      const sel = window.getSelection();
      const text = (sel && sel.toString() || '').trim();
      if (!text || !WORD.test(text) || !sel.rangeCount) return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      ipcRenderer.send('sel:lookup', { text, x: r.left, y: r.bottom });
    } catch {}
  }
  window.addEventListener('dblclick', () => { clearTimeout(timer); timer = setTimeout(report, 30); }, true);
  window.addEventListener('mouseup', (e) => {
    if (e.detail > 1) return; // dblclick handled above
    clearTimeout(timer); timer = setTimeout(report, 220);
  }, true);
}
