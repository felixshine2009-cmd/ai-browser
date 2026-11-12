'use strict';
// Light / dark / follow-system appearance for the whole app (desktop and iPad; the web app uses the same theme.js).
//  * nativeTheme.themeSource follows the mode, so native menus, dialogs, scrollbars, form controls and the
//    prefers-color-scheme media query of every page (internal and web) agree with the app.
//  * Internal pages get the resolved palette inlined into their HTML (no flash of the wrong theme on load);
//    afterwards src/renderer/static/i18n.js keeps them in step (settings:changed, theme:changed, OS changes).
//  * The window background (visible while a tab loads) follows the palette.
const { nativeTheme, BrowserWindow } = require('electron');
const Theme = require('../renderer/static/theme.js');
const store = require('./store');

let last = null; let onChange = null;
// resolve() only consults the OS value in 'system' mode, when themeSource is 'system' too
function systemDark() { try { return nativeTheme.shouldUseDarkColors; } catch { return true; } }
function appearance() { return Theme.normAppearance((store.getSettings() || {}).appearance); }
function current() { return Theme.resolve(appearance(), systemDark()); }

function sync() {
  const a = appearance();
  try {
    if (nativeTheme.themeSource !== a.mode) nativeTheme.themeSource = a.mode;
  } catch (e) { console.error('nativeTheme', e && e.message); }
  const r = current();
  for (const w of BrowserWindow.getAllWindows()) { try { w.setBackgroundColor(r.base); } catch {} }
  const changed = !last || last.id !== r.id || last.scheme !== r.scheme || last.mode !== r.mode;
  last = r;
  if (changed && onChange) { try { onChange(r); } catch (e) { console.error(e); } }
  return r;
}

function init(cb) {
  onChange = cb || null;
  try { nativeTheme.on('updated', () => { if (appearance().mode === 'system') sync(); }); } catch {}
  return sync();
}

// <html data-theme data-scheme style="color-scheme"> + the palette variables, right at the top of <head>
function injectHtml(html) {
  const r = current();
  const style = `<style id="aib-theme-vars">${Theme.css(r.id, 'desktop')}</style>`;
  let out = html.replace(/<html([^>]*)>/i, (m, attrs) => `<html${attrs.replace(/\s(data-theme|data-scheme|data-theme-mode)="[^"]*"/g, '')} data-theme="${r.id}" data-scheme="${r.scheme}" data-theme-mode="${r.mode}" style="color-scheme:${r.scheme}">`);
  out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, style + '</head>') : style + out;
  return out;
}

module.exports = { init, sync, current, injectHtml, Theme };
