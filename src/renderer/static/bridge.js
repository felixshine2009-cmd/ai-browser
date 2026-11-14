// Page-side bridge between extension iframes (aibext://) and the main process.
// - iframe -> page: {aibExtCall} (RPC to the extension entry), {aibExtHello}
// - main -> iframe: 'panel:call' (extension tools driving a panel page)
(function () {
  const pendingPanel = {};
  let n = 0;
  const readyFrames = new WeakSet();
  const events = {};
  const panelName = (id) => id === 'aib.geogebra' ? ' GeoGebra ' : id === 'aib.physics' ? '物理' : '';
  const Bridge = {
    mountPanel: null, // set by page: (extId, panelId) => iframe
    PANEL_LOAD_MS: 30000,
    onPanelEvent(fn) { (events.panel = events.panel || []).push(fn); },
    frameFor(extId, panelId) { return document.querySelector(`iframe[data-ext="${extId}"][data-panel="${panelId}"]`); },
    async panelCall(extId, panelId, method, args) {
      let f = Bridge.frameFor(extId, panelId);
      if (!f && Bridge.mountPanel) f = Bridge.mountPanel(extId, panelId);
      if (!f) throw new Error('panel not available');
      if (Bridge.showPanel) Bridge.showPanel(f);
      if (!f.dataset.loaded) await new Promise((res, rej) => {
        if (f.dataset.loaded) return res();
        const t = setTimeout(() => rej(new Error(`面板页面加载超时（${Bridge.PANEL_LOAD_MS / 1000} 秒）：${panelName(extId)}面板未能打开，请重试`)), Bridge.PANEL_LOAD_MS);
        f.addEventListener('load', () => { clearTimeout(t); res(); }, { once: true });
      });
      return new Promise((resolve, reject) => {
        const id = ++n;
        pendingPanel[id] = { resolve, reject };
        f.contentWindow.postMessage({ aibPanelCall: id, method, args }, '*');
      });
    }
  };
  window.addEventListener('message', async (ev) => {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    const frame = Array.from(document.querySelectorAll('iframe')).find(f => f.contentWindow === ev.source);
    if (!frame) return;
    if (m.aibExtHello) {
      ev.source.postMessage({ aibExtInit: true, info: { lang: I18N.lang } }, '*');
    } else if (m.aibExtCall) {
      const extId = frame.dataset.ext;
      if (!extId) return;
      try { const r = await window.aib.invoke('ext:rpc', extId, m.name, m.args); ev.source.postMessage({ aibExtReply: m.aibExtCall, result: r }, '*'); }
      catch (e) { ev.source.postMessage({ aibExtReply: m.aibExtCall, error: e.message }, '*'); }
    } else if (m.aibPanelReply) {
      const p = pendingPanel[m.aibPanelReply]; delete pendingPanel[m.aibPanelReply];
      if (p) m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
    } else if (m.aibPanelEvent) {
      (events.panel || []).forEach(fn => fn(m, frame));
    } else if (m.aibDictHeight) {
      /* informational */
    }
  });
  window.aib.on('panel:call', async (c) => {
    try { const r = await Bridge.panelCall(c.extId, c.panelId, c.method, c.args); await window.aib.invoke('panel:reply', c.reqId, r, null); }
    catch (e) { await window.aib.invoke('panel:reply', c.reqId, null, e.message); }
  });
  window.Bridge = Bridge;
})();
