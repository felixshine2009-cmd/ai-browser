// Injected by the iPad host into every web view at document start (WKUserScript), before any page script.
// Internal pages (aibrowser:) run it in the page world; web pages (http/https) run it in an isolated content world, so the
// page itself never sees it — the same isolation as Electron's contextIsolation preload.
// It provides the small part of Electron's renderer API that src/preload/preload.js uses (contextBridge, ipcRenderer,
// process) on top of window.webkit.messageHandlers.aib, then runs the desktop preload script unchanged (inlined at build time, see the marker below).
(function () {
  if (window.__aibRuntime) return; window.__aibRuntime = true;
  const H = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.aib;
  if (!H) return;
  const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  function enc(v, d) {
    if (d > 60 || v == null || typeof v !== 'object') return typeof v === 'function' || typeof v === 'undefined' ? null : v;
    if (v instanceof ArrayBuffer) return { __aibBytes: toB64(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) return { __aibBytes: toB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(x => enc(x, (d || 0) + 1));
    const o = {}; for (const k of Object.keys(v)) { if (v[k] !== undefined && typeof v[k] !== 'function') o[k] = enc(v[k], (d || 0) + 1); } return o;
  }
  function dec(v) {
    if (v == null || typeof v !== 'object') return v;
    if (typeof v.__aibBytes === 'string') { const s = atob(v.__aibBytes); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
    if (Array.isArray(v)) return v.map(dec);
    for (const k of Object.keys(v)) v[k] = dec(v[k]); return v;
  }
  const listeners = new Map();
  // native -> renderer events (webContents.send)
  window.__aibDispatch = function (channel, args) {
    const set = listeners.get(channel); if (!set) return;
    const a = dec(args || []);
    for (const cb of Array.from(set)) { try { cb({ sender: null }, ...a); } catch (e) { console.error(e); } }
  };
  const ipcRenderer = {
    invoke(channel, ...args) {
      return H.postMessage({ t: 'invoke', channel: String(channel), args: enc(args, 0) }).then((r) => {
        if (r && r.ok) return dec(r.result);
        throw new Error(`Error invoking remote method '${channel}': Error: ${(r && r.error) || 'failed'}`);
      });
    },
    send(channel, ...args) { try { H.postMessage({ t: 'send', channel: String(channel), args: enc(args, 0) }).catch(() => {}); } catch {} },
    on(channel, h) { let s = listeners.get(channel); if (!s) { s = new Set(); listeners.set(channel, s); } s.add(h); return ipcRenderer; },
    once(channel, h) { const w = (...a) => { ipcRenderer.removeListener(channel, w); h(...a); }; return ipcRenderer.on(channel, w); },
    removeListener(channel, h) { const s = listeners.get(channel); if (s) s.delete(h); return ipcRenderer; },
    removeAllListeners(channel) { listeners.delete(channel); return ipcRenderer; }
  };
  const contextBridge = { exposeInMainWorld(key, api) { try { Object.defineProperty(window, key, { value: api, configurable: false, writable: false }); } catch { window[key] = api; } } };
  const process = { platform: 'darwin', versions: {}, env: {}, type: 'renderer' };
  const require = (m) => (m === 'electron' ? { contextBridge, ipcRenderer } : {});
  try {
    /*PRELOAD*/
  } catch (e) { console.error('preload failed', e); }
  if (location.protocol === 'aibrowser:') {
    try { if (window.aib) window.aib.ipad = true; } catch {}
    const mark = () => { if (document.documentElement) document.documentElement.classList.add('aib-ipad'); };
    mark(); document.addEventListener('DOMContentLoaded', mark);
    // touch: long-press opens the same context menus that right-click opens on the desktop
    let lp = null, sx = 0, sy = 0, fired = false;
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { clearTimeout(lp); return; }
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY; fired = false; const target = e.target;
      clearTimeout(lp);
      lp = setTimeout(() => {
        if (target.closest && target.closest('input,textarea,[contenteditable="true"]')) return;
        fired = true;
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, screenX: sx, screenY: sy, button: 2, buttons: 2 }));
      }, 550);
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t && Math.hypot(t.clientX - sx, t.clientY - sy) > 10) clearTimeout(lp); }, { passive: true, capture: true });
    document.addEventListener('touchend', (e) => { clearTimeout(lp); if (fired) { fired = false; e.preventDefault(); } }, { capture: true });
    document.addEventListener('touchcancel', () => clearTimeout(lp), { capture: true });
  }
})();
