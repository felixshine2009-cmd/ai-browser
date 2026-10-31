// Verifies every i18n key referenced in renderer code exists in both languages.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'src', 'renderer');
const strings = JSON.parse(fs.readFileSync(path.join(root, 'static', 'strings.json'), 'utf8'));
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : /\.(js|html)$/.test(f) && files.push(p); } })(root);
const keys = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) keys.add(m[1]);
  for (const m of s.matchAll(/\bt\('([a-zA-Z0-9_.]+)'[,)]/g)) keys.add(m[1]);
  for (const m of s.matchAll(/\b(?:title|clear|empty|search): '([a-z]+\.[a-zA-Z.]+)'/g)) keys.add(m[1]);
  for (const m of s.matchAll(/ROLE_ZH|t\(ROLE_ZH/g)) {}
}
for (const r of ['subj','pred','obj','attr','adv','comp']) keys.add('role.' + r);
for (const k of ['history','downloads','cache','cookies']) keys.add('privacy.' + k);
for (const k of ['progressing','completed','cancelled','interrupted','paused']) keys.add('dl.state.' + k);
for (const k of ['history','downloads','extensions','bookmarks','find','print','zoom','devtools','settings']) keys.add('menu.' + k);
let missing = [];
for (const k of keys) for (const l of ['zh', 'en']) if (!(k in strings[l])) missing.push(l + ':' + k);
const extra = Object.keys(strings.zh).filter(k => !(k in strings.en)).concat(Object.keys(strings.en).filter(k => !(k in strings.zh)));
console.log(`keys referenced: ${keys.size}; missing: ${missing.length}; zh/en mismatch: ${extra.length}`);
if (missing.length) console.log(missing.join('\n'));
if (extra.length) console.log(extra.join('\n'));
process.exit(missing.length || extra.length ? 1 : 0);
