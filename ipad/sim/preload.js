'use strict';
// Simulator stand-in for the WKWebView bridge: window.webkit.messageHandlers.aib.postMessage(m) -> Promise (like
// WKScriptMessageHandlerWithReply), then the same runtime.js the Swift host injects at document start.
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
window.webkit = { messageHandlers: { aib: { postMessage: (m) => ipcRenderer.invoke('aib', m) } } };
window.__simProto = location.protocol;
if (/^(aibrowser|https?):$/.test(location.protocol)) {
  try { (0, eval)(fs.readFileSync(path.join(process.env.AIB_BUNDLE, 'web', 'inject', 'runtime.js'), 'utf8')); } catch (e) { window.__simErr = String(e && e.stack || e); console.error('runtime.js', e); }
}
