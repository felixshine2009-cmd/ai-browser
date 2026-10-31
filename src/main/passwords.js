'use strict';
// Built-in password manager. Passwords are encrypted with Electron safeStorage (macOS Keychain) and never leave main
// except (a) autofill into a page of the SAME origin, (b) an explicit reveal / export after Touch ID / system-password auth.
// Never recorded in private (incognito) tabs. No AI tool can read passwords (see tools.js: no password tools exist).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage, systemPreferences, dialog } = require('electron');
const { execFile } = require('child_process');
const store = require('./store');

const isEn = () => store.getSettings().lang === 'en';
const L = (zh, en) => (isEn() ? en : zh);
let db = null;
const file = () => path.join(app.getPath('userData'), 'passwords.json');
function load() { if (db) return db; try { db = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { db = { version: 1, items: [], never: [] }; } return db; }
function save() { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file() + '.tmp', JSON.stringify(db), { mode: 0o600 }); fs.renameSync(file() + '.tmp', file()); }

function enc(plain) { try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(plain).toString('base64'); } catch {} return 'b64:' + Buffer.from(plain, 'utf8').toString('base64'); }
function dec(s) { try { if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')); if (s.startsWith('b64:')) return Buffer.from(s.slice(4), 'base64').toString('utf8'); } catch {} return ''; }

const cfg = () => Object.assign({ save: true, autofill: true }, store.getSettings().passwords || {});
const originOf = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin : ''; } catch { return ''; } };
const strip = (i) => ({ id: i.id, origin: i.origin, url: i.url, username: i.username, note: i.note || '', created: i.created, updated: i.updated, lastUsed: i.lastUsed || 0 });

// ---------------------------------------------------------------- authentication (Touch ID / system password)
let unlockedUntil = 0;
async function authenticate(reason) {
  if (Date.now() < unlockedUntil) return true;
  const hook = process.env.AIB_TEST_AUTH;
  let ok = false;
  if (hook) ok = hook === 'ok';
  else if (process.platform === 'darwin' && systemPreferences.canPromptTouchID && systemPreferences.canPromptTouchID()) {
    try { await systemPreferences.promptTouchID(reason); ok = true; } catch { ok = false; }
  } else if (process.platform === 'darwin') {
    // no Touch ID hardware: ask for the macOS account password via the system authorization dialog
    ok = await new Promise(res => execFile('/usr/bin/osascript', ['-e', `do shell script "true" with prompt ${JSON.stringify(reason)} with administrator privileges`], { timeout: 120000 }, (err) => res(!err)));
  } else {
    const r = await dialog.showMessageBox({ type: 'question', buttons: [L('验证', 'Verify'), L('取消', 'Cancel')], defaultId: 0, cancelId: 1, message: reason });
    ok = r.response === 0;
  }
  if (ok) unlockedUntil = Date.now() + 60000; // 60 s unlocked window for reveal / export
  return ok;
}
const lock = () => { unlockedUntil = 0; };

// ---------------------------------------------------------------- CRUD
function list(q) {
  q = String(q || '').toLowerCase().trim();
  return load().items.filter(i => !q || i.origin.toLowerCase().includes(q) || i.username.toLowerCase().includes(q) || (i.note || '').toLowerCase().includes(q))
    .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username)).map(strip);
}
function upsert({ url, username, password, note }, { touch = true } = {}) {
  const origin = originOf(url); if (!origin || !password) throw new Error(L('网址或密码为空', 'URL or password is empty'));
  const d = load(); const now = Date.now();
  let it = d.items.find(i => i.origin === origin && i.username === (username || ''));
  if (it) { it.pw = enc(password); it.updated = now; if (note != null) it.note = note; it.url = url || it.url; }
  else { it = { id: 'p' + crypto.randomBytes(5).toString('hex'), origin, url: url || origin, username: username || '', pw: enc(password), note: note || '', created: now, updated: now, lastUsed: 0 }; d.items.push(it); }
  save(); return strip(it);
}
function update(id, patch) {
  const it = load().items.find(i => i.id === id); if (!it) throw new Error('not found');
  if (patch.username != null) it.username = String(patch.username);
  if (patch.url != null) { const o = originOf(patch.url); if (!o) throw new Error(L('网址无效', 'invalid URL')); it.url = patch.url; it.origin = o; }
  if (patch.password) it.pw = enc(String(patch.password));
  if (patch.note != null) it.note = String(patch.note);
  it.updated = Date.now(); save(); return strip(it);
}
function remove(id) { const d = load(); d.items = d.items.filter(i => i.id !== id); save(); }
function clearAll() { const d = load(); d.items = []; save(); }

async function reveal(id) {
  if (!(await authenticate(L('查看已保存的密码', 'View a saved password')))) throw new Error(L('验证未通过', 'Authentication failed'));
  const it = load().items.find(i => i.id === id); if (!it) throw new Error('not found');
  return { id, username: it.username, password: dec(it.pw) };
}

// ---------------------------------------------------------------- autofill (called from main with the TRUSTED sender origin)
function credentialsFor(senderUrl) {
  if (!cfg().autofill) return [];
  const o = originOf(senderUrl); if (!o) return [];
  return load().items.filter(i => i.origin === o).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).map(i => ({ id: i.id, username: i.username }));
}
function fillCredential(senderUrl, id) {
  const o = originOf(senderUrl); const it = load().items.find(i => i.id === id && i.origin === o);
  if (!it) return null; it.lastUsed = Date.now(); save(); return { username: it.username, password: dec(it.pw) };
}

// ---------------------------------------------------------------- save decision on login submit
function decide(senderUrl, username, password) {
  if (!cfg().save || !password) return { action: 'none' };
  const o = originOf(senderUrl); if (!o) return { action: 'none' };
  const d = load(); if (d.never.includes(o)) return { action: 'none' };
  const same = d.items.find(i => i.origin === o && i.username === (username || ''));
  if (same) return dec(same.pw) === password ? { action: 'none', existing: true } : { action: 'update', origin: o, username };
  return { action: 'save', origin: o, username };
}
function neverFor(origin) { const d = load(); if (origin && !d.never.includes(origin)) { d.never.push(origin); save(); } }
const neverList = () => load().never.slice();
function removeNever(origin) { const d = load(); d.never = d.never.filter(x => x !== origin); save(); }

// ---------------------------------------------------------------- CSV (Chrome format: name,url,username,password,note)
const q = (s) => { s = String(s == null ? '' : s); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
async function exportCsv() {
  if (!(await authenticate(L('导出所有密码（明文 CSV）', 'Export all passwords (plain-text CSV)')))) throw new Error(L('验证未通过', 'Authentication failed'));
  const rows = [['name', 'url', 'username', 'password', 'note']].concat(load().items.map(i => [new URL(i.origin).hostname, i.url, i.username, dec(i.pw), i.note || '']));
  return rows.map(r => r.map(q).join(',')).join('\n') + '\n';
}
function parseCsv(text) {
  const rows = []; let row = [], cur = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += c; }
    else if (c === '"') inq = true; else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some(x => x !== '')) rows.push(row); }
  return rows;
}
function importCsv(text) {
  const rows = parseCsv(String(text).replace(/^\uFEFF/, '')); if (rows.length < 2) return { added: 0, skipped: 0 };
  const h = rows[0].map(x => x.trim().toLowerCase()); const col = (...n) => h.findIndex(x => n.includes(x));
  const iu = col('url', 'origin', 'login_uri', 'website'), in_ = col('username', 'login_username', 'user', 'email'), ip = col('password', 'login_password', 'pass'), inote = col('note', 'notes');
  if (iu < 0 || ip < 0) throw new Error(L('CSV 缺少 url / password 列', 'CSV needs url and password columns'));
  let added = 0, skipped = 0;
  for (const r of rows.slice(1)) { try { upsert({ url: r[iu], username: in_ >= 0 ? r[in_] : '', password: r[ip], note: inote >= 0 ? r[inote] : '' }); added++; } catch { skipped++; } }
  return { added, skipped };
}

module.exports = { list, upsert, update, remove, clearAll, reveal, credentialsFor, fillCredential, decide, neverFor, neverList, removeNever, exportCsv, importCsv, authenticate, lock, cfg, originOf, parseCsv, _reset() { db = null; } };
