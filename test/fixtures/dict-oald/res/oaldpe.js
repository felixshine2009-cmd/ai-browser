/* OALD-style entry script: reads its settings from localStorage, numbers and expands the senses, wires the
   collapsible "Extra examples" boxes */
$(function () {
  var mode = localStorage.getItem('oald.mode') || 'full';
  localStorage.setItem('oald.mode', mode);
  $('.sense').each(function (i, el) { var n = document.createElement('span'); n.className = 'sensenum'; n.textContent = (i + 1) + ' '; el.insertBefore(n, el.firstChild); });
  $('.unbox .heading').on('click', function () { this.parentNode.classList.toggle('is-open'); });
  $('body').addClass('oald-ready');
  document.body.setAttribute('data-oald-mode', mode);
});
