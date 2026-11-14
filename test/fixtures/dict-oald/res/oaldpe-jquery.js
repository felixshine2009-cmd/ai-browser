/* minimal jQuery-like helper used by the fixture's entry script */
(function (w) {
  function Q(sel) { this.els = typeof sel === 'string' ? Array.prototype.slice.call(document.querySelectorAll(sel)) : [sel]; }
  Q.prototype.addClass = function (c) { this.els.forEach(function (e) { e.classList.add(c); }); return this; };
  Q.prototype.on = function (ev, fn) { this.els.forEach(function (e) { e.addEventListener(ev, fn); }); return this; };
  Q.prototype.each = function (fn) { this.els.forEach(function (e, i) { fn.call(e, i, e); }); return this; };
  w.$ = function (sel) { if (typeof sel === 'function') { if (document.readyState !== 'loading') sel(); else document.addEventListener('DOMContentLoaded', sel); return; } return new Q(sel); };
})(window);
