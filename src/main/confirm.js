'use strict';
// Main-process side of the shared confirmation dialog. Agent tools that delete anything call ask(); the request is shown
// to the user in an internal page through the SAME renderer modal (confirm.js). No answer / timeout / closed = declined.
const { webContents } = require('electron');
const pending = new Map(); // id -> { spec, resolve, timer }
let seq = 0;

function targets() { return webContents.getAllWebContents().filter(wc => { try { return !wc.isDestroyed() && (wc.getURL() || '').startsWith('aibrowser://') && !/^aibrowser:\/\/(chrome|menu|find|lookup)/.test(wc.getURL()); } catch { return false; } }); }

function ask(spec, { timeoutMs = 120000 } = {}) {
  // test hook: deterministic answers without a human
  if (process.env.AIB_TEST_CONFIRM === 'yes') return Promise.resolve(true);
  if (process.env.AIB_TEST_CONFIRM === 'no') return Promise.resolve(false);
  const id = 'cf' + (++seq) + Date.now().toString(36);
  return new Promise(resolve => {
    const timer = setTimeout(() => finish(id, false), timeoutMs);
    pending.set(id, { spec: { id, ...spec }, resolve, timer });
    // show on the active tab when it is an internal page, otherwise open the history page to host the dialog
    const tabs = require('./tabs');
    const a = tabs.activeTab();
    const url = a && a.wc && !a.wc.isDestroyed() ? (a.wc.getURL() || '') : '';
    if (!url.startsWith('aibrowser://')) { try { tabs.openInternal(spec.host || 'history'); } catch {} }
    const send = () => { const p = pending.get(id); if (!p) return; const active = tabs.activeTab(); const wc = active && active.wc; if (wc && !wc.isDestroyed() && (wc.getURL() || '').startsWith('aibrowser://')) try { wc.send('confirm:request', p.spec); } catch {} };
    send(); setTimeout(send, 600); // page load race is also covered by confirm:pending pull
  });
}
function finish(id, ok) {
  const p = pending.get(id); if (!p) return false;
  clearTimeout(p.timer); pending.delete(id);
  for (const wc of targets()) try { wc.send('confirm:cancel', id); } catch {}
  p.resolve(!!ok); return true;
}
const list = () => Array.from(pending.values()).map(p => p.spec);
module.exports = { ask, answer: (id, ok) => finish(id, ok), list };
