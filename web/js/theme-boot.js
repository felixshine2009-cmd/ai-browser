/* Web app: apply the saved light / dark / follow-system appearance before first paint (classic script in <head>),
   keep following the OS while in 'system' mode, and hand the palette to the embedded panels (GeoGebra, physics). */
(function () {
  var T = window.AIBTheme; if (!T) return;
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem('aib.settings.v1') || '{}') || {}; } catch (e) {}
  var appearance = saved.appearance || { theme: saved.theme };
  function msg(r) { return { aibTheme: { id: r.id, scheme: r.scheme, mode: r.mode, css: T.css(r.id, 'ext') } }; }
  function toFrames(r) { var fs = document.querySelectorAll('iframe'); for (var i = 0; i < fs.length; i++) { try { fs[i].contentWindow.postMessage(msg(r), '*'); } catch (e) {} } }
  var ctl = T.follow(document, appearance, 'web', function (r) { toFrames(r); try { window.dispatchEvent(new CustomEvent('aib-theme', { detail: r })); } catch (e) {} });
  window.__aibTheme = ctl;
  window.addEventListener('message', function (ev) { var m = ev.data; if (m && m.aibThemeHello && ev.source) { try { ev.source.postMessage(msg(ctl.current()), '*'); } catch (e) {} } });
  document.addEventListener('load', function (ev) { var f = ev.target; if (f && f.tagName === 'IFRAME') { try { f.contentWindow.postMessage(msg(ctl.current()), '*'); } catch (e) {} } }, true);
})();
