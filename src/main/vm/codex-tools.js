/* Codex-style VM tools: the AI's working toolset inside its Linux VM (root, full control of the guest; the host is
 * never touched). Shared by the desktop app, the iPad app (same main process) and the web app (web/js/vm-codex-tools.js
 * is an identical copy). Everything is built on three guest primitives every VM backend already has:
 *   io.sh(cmd, { cwd, timeoutSec, stdin, signal, onOutput }) -> { exitCode, stdout, stderr }
 *   io.read(path, maxBytes) -> { data: Uint8Array, size, truncated }
 *   io.write(path, Uint8Array)
 * plus optional io.offlineInstall(manager, names, opts) for VMs without network (iPad: the app downloads packages).
 * Tools: vm_view, vm_edit, vm_apply_patch, vm_search, vm_list, vm_bg, vm_pkg, vm_service, vm_git. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AIBVmTools = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const enc = (s) => new TextEncoder().encode(String(s));
  const dec = (b) => new TextDecoder('utf-8').decode(b);
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const str = (d) => ({ type: 'string', description: d });
  const num = (d) => ({ type: 'number', description: d });
  const bool = (d) => ({ type: 'boolean', description: d });
  const obj = (properties, required) => ({ type: 'object', properties, required: required || [] });
  const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '\n…（已截断 ' + (s.length - n) + ' 个字符 / truncated）' : s; };
  const clipTail = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? '…（前面省略 ' + (s.length - n) + ' 个字符 / earlier output omitted）\n' + s.slice(-n) : s; };
  const WORK = '/root/work';
  const abs = (p, cwd) => { p = String(p || '').trim(); if (!p) throw new Error('缺少路径 / path is required'); return p.startsWith('/') ? normPath(p) : normPath((cwd || WORK) + '/' + p); };
  function normPath(p) { const out = []; for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return '/' + out.join('/'); }
  const SVC = '/persist/aib/aib-svc';
  const SVC_VERSION = '1';
  const JOBS = '/tmp/aib-jobs';

  // ------------------------------------------------------------------ text helpers
  function splitLines(t) { const crlf = /\r\n/.test(t); const s = crlf ? t.replace(/\r\n/g, '\n') : t; const endNl = s.endsWith('\n'); const lines = (endNl ? s.slice(0, -1) : s).split('\n'); if (s === '') lines.length = 0; return { lines, crlf, endNl: endNl || s === '' }; }
  function joinLines(o, lines) { let s = lines.join('\n'); if (o.endNl && lines.length) s += '\n'; return o.crlf ? s.replace(/\n/g, '\r\n') : s; }
  function numbered(lines, from) { return lines.map((l, i) => String(from + i).padStart(6) + '\t' + (l.length > 2000 ? l.slice(0, 2000) + ' …' : l)).join('\n'); }
  function snippet(lines, a, b) { const s = Math.max(0, a - 3), e = Math.min(lines.length, b + 3); return numbered(lines.slice(s, e), s + 1); }
  function lineOf(text, idx) { let n = 1; for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++; return n; }

  // ------------------------------------------------------------------ apply_patch (Codex format) parser
  function parsePatch(text) {
    const L = String(text).replace(/\r\n/g, '\n').split('\n');
    let i = 0; while (i < L.length && !L[i].trim()) i++;
    if (!/^\*\*\* Begin Patch\s*$/.test(L[i] || '')) throw new Error('补丁必须以 "*** Begin Patch" 开头 / patch must start with "*** Begin Patch"');
    i++; const ops = [];
    while (i < L.length) {
      const l = L[i];
      if (/^\*\*\* End Patch\s*$/.test(l)) return ops;
      let m;
      if ((m = /^\*\*\* Add File: (.+)$/.exec(l))) {
        i++; const body = [];
        while (i < L.length && !/^\*\*\* /.test(L[i])) { if (!L[i].startsWith('+')) { if (L[i] === '' && i === L.length - 1) break; throw new Error('Add File 的每一行都必须以 + 开头（第 ' + (i + 1) + ' 行）'); } body.push(L[i].slice(1)); i++; }
        ops.push({ type: 'add', path: m[1].trim(), content: body.join('\n') + (body.length ? '\n' : '') }); continue;
      }
      if ((m = /^\*\*\* Delete File: (.+)$/.exec(l))) { ops.push({ type: 'delete', path: m[1].trim() }); i++; continue; }
      if ((m = /^\*\*\* Update File: (.+)$/.exec(l))) {
        i++; const op = { type: 'update', path: m[1].trim(), moveTo: null, hunks: [] };
        if ((m = /^\*\*\* Move to: (.+)$/.exec(L[i] || ''))) { op.moveTo = m[1].trim(); i++; }
        let h = null;
        while (i < L.length && !/^\*\*\* (End Patch|Add File|Delete File|Update File)/.test(L[i])) {
          const x = L[i];
          if (x.startsWith('@@')) { h = { header: x.replace(/^@@\s?/, '').replace(/\s*@@.*$/, '').trim(), old: [], new: [], eof: false }; op.hunks.push(h); i++; continue; }
          if (/^\*\*\* End of File\s*$/.test(x)) { if (h) h.eof = true; i++; continue; }
          if (!h) { h = { header: '', old: [], new: [], eof: false }; op.hunks.push(h); }
          if (x.startsWith('+')) h.new.push(x.slice(1));
          else if (x.startsWith('-')) h.old.push(x.slice(1));
          else if (x.startsWith(' ')) { h.old.push(x.slice(1)); h.new.push(x.slice(1)); }
          else if (x === '') { if (i === L.length - 1) { i++; continue; } h.old.push(''); h.new.push(''); }
          else throw new Error('无法解析的补丁行（第 ' + (i + 1) + ' 行）：' + x.slice(0, 80) + ' — 每行需以空格、+ 或 - 开头 / every hunk line must start with " ", "+" or "-"');
          i++;
        }
        if (!op.hunks.length && !op.moveTo) throw new Error('Update File 没有任何修改：' + op.path);
        ops.push(op); continue;
      }
      if (!l.trim()) { i++; continue; }
      throw new Error('无法解析的补丁行（第 ' + (i + 1) + ' 行）：' + l.slice(0, 80));
    }
    throw new Error('补丁缺少结尾 "*** End Patch" / missing "*** End Patch"');
  }
  function seek(lines, pat, from, eof) {
    if (!pat.length) return eof ? lines.length : from;
    const cmps = [(a, b) => a === b, (a, b) => a.trimEnd() === b.trimEnd(), (a, b) => a.trim() === b.trim(),
      (a, b) => a.trim().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2010-\u2015]/g, '-') === b.trim().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2010-\u2015]/g, '-')];
    for (const eq of cmps) {
      if (eof) { const s = lines.length - pat.length; if (s >= from && pat.every((p, k) => eq(lines[s + k], p))) return s; }
      for (let s = from; s + pat.length <= lines.length; s++) if (pat.every((p, k) => eq(lines[s + k], p))) return s;
    }
    return -1;
  }
  function applyHunks(text, hunks, file) {
    const o = splitLines(text); const lines = o.lines.slice(); let cur = 0;
    for (const h of hunks) {
      if (h.header) { const k = seek(lines, [h.header], cur, false); if (k >= 0) cur = k + 1; else if (seek(lines, [h.header], 0, false) < 0) throw new Error(`${file}：找不到上下文 "@@ ${h.header}" / context not found`); }
      let old = h.old, neu = h.new;
      let at = seek(lines, old, cur, h.eof);
      if (at < 0 && old.length && old[old.length - 1] === '') { old = old.slice(0, -1); if (neu[neu.length - 1] === '') neu = neu.slice(0, -1); at = seek(lines, old, cur, h.eof); }
      if (at < 0) at = seek(lines, old, 0, h.eof);
      if (at < 0) throw new Error(`${file}：补丁片段与文件内容不匹配（${old.length} 行，起始："${(old[0] || '').slice(0, 60)}"）。请先用 vm_view 查看当前内容 / hunk does not match, view the file first`);
      lines.splice(at, old.length, ...neu); cur = at + neu.length;
    }
    if (!lines.length) o.endNl = false; else if (!o.endNl && hunks.some(h => h.eof)) o.endNl = false; else if (!o.lines.length) o.endNl = true;
    return joinLines(o, lines);
  }

  // ------------------------------------------------------------------ service supervisor (installed in the guest on first use)
  const SVC_SCRIPT = `#!/bin/sh
# aib-svc ${SVC_VERSION}: minimal service supervisor for the AI Browser VM (used when the guest has no systemd / OpenRC).
# Definitions persist in /persist/aib/services/<name>/{cmd,cwd,enabled}; logs in /var/log/aib-svc/<name>.log.
D=/persist/aib/services; R=/run/aib-svc; LOGD=/var/log/aib-svc
mkdir -p "$D" "$R" "$LOGD"
pidof_svc() { [ -f "$R/$1.pid" ] && p=$(cat "$R/$1.pid") && kill -0 "$p" 2>/dev/null && echo "$p"; }
start() {
  [ -f "$D/$1/cmd" ] || { echo "no such service: $1" >&2; return 2; }
  [ -n "$(pidof_svc "$1")" ] && { echo "$1 already running"; return 0; }
  rm -f "$R/$1.stop"; cwd=$(cat "$D/$1/cwd" 2>/dev/null || echo /root)
  setsid sh -c "while [ ! -f '$R/$1.stop' ]; do echo \\"[aib-svc] start \\$(date '+%F %T')\\"; (cd '$cwd' && exec sh '$D/$1/cmd'); echo \\"[aib-svc] exited \\$? \\$(date '+%F %T')\\"; [ -f '$R/$1.stop' ] && break; sleep 2; done" </dev/null >>"$LOGD/$1.log" 2>&1 &
  echo $! > "$R/$1.pid"; echo "$1 started (pid $!)"
}
stop() {
  touch "$R/$1.stop"; p=$(pidof_svc "$1")
  if [ -n "$p" ]; then kill -TERM -"$p" 2>/dev/null || kill -TERM "$p"; i=0; while kill -0 "$p" 2>/dev/null && [ $i -lt 20 ]; do sleep 0.25; i=$((i+1)); done; kill -KILL -"$p" 2>/dev/null; fi
  rm -f "$R/$1.pid"; echo "$1 stopped"
}
status() { p=$(pidof_svc "$1"); en=no; [ -f "$D/$1/enabled" ] && en=yes; if [ -n "$p" ]; then echo "$1 running pid=$p enabled=$en"; else echo "$1 stopped enabled=$en"; fi; }
case "$1" in
  list) for s in "$D"/*/; do [ -d "$s" ] || continue; n=$(basename "$s"); status "$n"; echo "    cmd: $(head -c 200 "$s/cmd" | tr '\\n' ' ')"; done ;;
  start|stop|status) start_stop=$1; shift; $start_stop "$1" ;;
  restart) stop "$2"; start "$2" ;;
  enable) [ -f "$D/$2/cmd" ] || { echo "no such service: $2" >&2; exit 2; }; touch "$D/$2/enabled"; echo "$2 enabled (starts at VM boot)" ;;
  disable) rm -f "$D/$2/enabled"; echo "$2 disabled" ;;
  logs) tail -n "\${3:-100}" "$LOGD/$2.log" 2>/dev/null ;;
  remove) stop "$2" >/dev/null; rm -rf "$D/$2" "$LOGD/$2.log"; echo "$2 removed" ;;
  boot) for s in "$D"/*/; do [ -f "$s/enabled" ] && start "$(basename "$s")"; done ;;
  *) echo "usage: aib-svc list|start|stop|restart|status|enable|disable|logs|remove|boot [name]"; exit 2 ;;
esac
`;

  // ------------------------------------------------------------------ tool definitions
  const DEFS = [
    { name: 'vm_view', description: 'View a file in your Linux VM with line numbers (like `cat -n`), or list a directory. Use offset/limit for long files. Always view a file before editing it.',
      parameters: obj({ path: str('file or directory (absolute, or relative to cwd)'), offset: num('first line to show (1-based, default 1)'), limit: num('number of lines (default 400, max 2000)'), cwd: str('base for relative paths (default /root/work)') }, ['path']) },
    { name: 'vm_edit', description: 'Edit a file in the Linux VM precisely. Either replace an exact string (old_string → new_string; must be unique unless replace_all), or replace a line range (start_line..end_line → new_string), or insert new_string after insert_after_line (0 = top). create=true writes a new file with new_string. Returns the changed region with line numbers.',
      parameters: obj({ path: str('file path'), old_string: str('exact text to replace (include enough context to be unique)'), new_string: str('replacement / inserted text / new file content'), replace_all: bool('replace every occurrence of old_string'), start_line: num('line-range mode: first line (1-based)'), end_line: num('line-range mode: last line (inclusive)'), insert_after_line: num('insert mode: line after which to insert (0 = beginning)'), create: bool('create (or overwrite) the file with new_string'), cwd: str('base for relative paths') }, ['path']) },
    { name: 'vm_apply_patch', description: 'Apply a multi-file patch in the Linux VM. Preferred format (Codex apply_patch):\n*** Begin Patch\n*** Add File: path\n+line\n*** Update File: path\n*** Move to: new/path   (optional)\n@@ optional line of context, e.g. a function header\n context line\n-removed line\n+added line\n*** Delete File: path\n*** End Patch\nUse about 3 lines of context around each change; relative paths are resolved against cwd. A unified diff (git diff / diff -u) is also accepted and applied with git apply or patch. All files are checked before anything is written.',
      parameters: obj({ patch: str('the patch text'), cwd: str('base directory for relative paths (default /root/work)') }, ['patch']) },
    { name: 'vm_search', description: 'Search file contents in the Linux VM (ripgrep when available, else grep). Regex by default. Skips .git, node_modules and binary files.',
      parameters: obj({ pattern: str('regular expression (or literal text with fixed=true)'), path: str('directory or file to search (default /root/work)'), glob: str('only files matching this glob, e.g. "*.py"'), ignore_case: bool('case-insensitive'), fixed: bool('treat pattern as literal text'), context: num('lines of context around each match (0-5)'), files_only: bool('list matching files only'), max_results: num('max output lines (default 200, max 2000)') }, ['pattern']) },
    { name: 'vm_list', description: 'List a directory tree in the Linux VM (files with sizes, directories end with /). Skips .git, node_modules, __pycache__ and hidden entries unless all=true.',
      parameters: obj({ path: str('directory (default /root/work)'), depth: num('max depth (default 2, max 8)'), all: bool('include hidden and ignored entries'), max_entries: num('default 400, max 3000') }) },
    { name: 'vm_bg', description: 'Background processes in the Linux VM (servers, long builds, training runs, watchers). action=start runs `command` detached and returns an id immediately; output goes to a log. action=output shows new output (since=offset from the last call) or the last lines; action=wait waits up to timeoutSec for it to finish; action=list shows all jobs; action=kill stops the job and its children.',
      parameters: obj({ action: { type: 'string', enum: ['start', 'list', 'output', 'wait', 'kill'] }, command: str('start: shell command'), cwd: str('start: working directory (default /root/work)'), name: str('start: optional label'), id: str('job id (output / wait / kill)'), since: num('output: byte offset returned by the previous call'), tail: num('output: number of last lines when since is not given (default 100)'), timeoutSec: num('wait: max seconds (default 60, max 900)') }, ['action']) },
    { name: 'vm_pkg', description: 'Manage software packages in the Linux VM with its package manager (apk on Alpine, apt on Debian), or pip / npm. Actions: install, remove, search, info, list, update (refresh indexes), upgrade.',
      parameters: obj({ action: { type: 'string', enum: ['install', 'remove', 'search', 'info', 'list', 'update', 'upgrade'] }, packages: { type: 'array', items: { type: 'string' }, description: 'package names (install / remove / info), or one search term' }, manager: { type: 'string', enum: ['auto', 'apk', 'apt', 'pip', 'npm'], description: 'default auto = the distribution package manager' } }, ['action']) },
    { name: 'vm_service', description: 'Long-running services in the Linux VM (web servers, databases, daemons) that restart if they crash and can start at VM boot. Uses systemd or OpenRC when the guest runs them, otherwise the built-in aib-svc supervisor. create defines a service from a shell command; then start / stop / restart / status / enable (start at boot) / disable / logs / remove / list.',
      parameters: obj({ action: { type: 'string', enum: ['list', 'create', 'start', 'stop', 'restart', 'status', 'enable', 'disable', 'logs', 'remove'] }, name: str('service name (letters, digits, - _ .)'), command: str('create: shell command that runs in the foreground, e.g. "python3 -m http.server 8000"'), cwd: str('create: working directory (default /root/work)'), lines: num('logs: number of lines (default 100)') }, ['action']) },
    { name: 'vm_git', description: 'Run git in the Linux VM: e.g. args ["clone","https://…"], ["status"], ["diff"], ["add","-A"], ["commit","-m","msg"], ["log","--oneline","-20"], ["checkout","-b","fix"]. Runs non-interactively (no pager, no prompts); a default author identity is set if none is configured.',
      parameters: obj({ args: { type: 'array', items: { type: 'string' }, description: 'git arguments' }, repo: str('repository directory (default /root/work)'), timeoutSec: num('default 600') }, ['args']) }
  ];
  const LABELS = {
    vm_view: ['查看文件', 'View file'], vm_edit: ['编辑文件', 'Edit file'], vm_apply_patch: ['应用补丁', 'Apply patch'], vm_search: ['搜索代码', 'Search'],
    vm_list: ['列出目录', 'List files'], vm_bg: ['后台进程', 'Background job'], vm_pkg: ['软件包', 'Packages'], vm_service: ['服务', 'Service'], vm_git: ['Git', 'Git']
  };

  function create(io) {
    const sh = async (cmd, o) => { const r = await io.sh(cmd, Object.assign({ timeoutSec: 120, quick: true }, o || {})); return { code: r.exitCode, out: r.stdout || '', err: r.stderr || '', r }; };
    const readText = async (p) => { const r = await io.read(p, 16 * 1024 * 1024); if (r.truncated) throw new Error(p + '：文件超过 16 MB / file too large'); return dec(r.data); };
    const writeText = (p, t) => io.write(p, enc(t));
    async function kind(p) { const r = await sh(`if [ -d ${q(p)} ]; then echo dir; elif [ -f ${q(p)} ]; then echo file; elif [ -e ${q(p)} ]; then echo other; else echo none; fi`, { timeoutSec: 30 }); return r.out.trim(); }
    let rg = null, pm = null, init = null;
    async function hasRg(ctx) {
      if (rg !== null) return rg;
      rg = (await sh('command -v rg >/dev/null 2>&1 && echo y', { timeoutSec: 30 })).out.trim() === 'y';
      if (!rg && io.network !== false) { // first use on an older image: try to add ripgrep quietly
        ctx.status && ctx.status('正在安装 ripgrep…');
        const r = await sh('(command -v apk >/dev/null && apk add -q --no-progress ripgrep) || (command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ripgrep) >/dev/null 2>&1; command -v rg >/dev/null && echo y', { timeoutSec: 120 }).catch(() => ({ out: '' }));
        rg = r.out.trim().endsWith('y');
      }
      return rg;
    }
    async function pkgManager() {
      if (pm) return pm;
      const r = await sh('if command -v apk >/dev/null 2>&1; then echo apk; elif command -v apt-get >/dev/null 2>&1; then echo apt; else echo none; fi', { timeoutSec: 30 });
      pm = r.out.trim() || 'none'; return pm;
    }
    async function svcMode() {
      const r = await sh('if [ -d /run/systemd/system ] && command -v systemctl >/dev/null; then echo systemd; elif command -v rc-service >/dev/null && [ -d /run/openrc ]; then echo openrc; else echo aib; fi', { timeoutSec: 30 });
      return r.out.trim();
    }
    async function ensureSvc() {
      const r = await sh(`grep -q 'aib-svc ${SVC_VERSION}:' ${SVC} 2>/dev/null && echo ok`, { timeoutSec: 30 });
      if (r.out.trim() !== 'ok') { await io.write(SVC, enc(SVC_SCRIPT)); await sh(`chmod 755 ${SVC}`, { timeoutSec: 30 }); }
    }
    const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
    const PKG = /^[A-Za-z0-9@][A-Za-z0-9@._+:\/=<>~^*-]{0,200}$/;

    const run = {
      async vm_view(a) {
        const p = abs(a.path, a.cwd); const k = await kind(p);
        if (k === 'none') throw new Error('不存在：' + p + ' / no such file or directory');
        if (k === 'dir') return run.vm_list({ path: p, depth: 1 });
        const r = await io.read(p, 16 * 1024 * 1024); const text = dec(r.data);
        if (/\u0000/.test(text.slice(0, 8000))) return { path: p, size: r.size, binary: true, note: '二进制文件，请用 vm_shell（如 file / xxd / hexdump）查看 / binary file' };
        const o = splitLines(text); const total = o.lines.length;
        const off = Math.max(1, Math.floor(Number(a.offset) || 1)); const lim = Math.max(1, Math.min(2000, Math.floor(Number(a.limit) || 400)));
        const part = o.lines.slice(off - 1, off - 1 + lim);
        const res = { path: p, totalLines: total, from: off, to: off - 1 + part.length, content: clip(numbered(part, off), 120000) };
        if (off - 1 + part.length < total) res.more = `还有 ${total - (off - 1 + part.length)} 行，用 offset=${off + part.length} 继续 / more lines: use offset=${off + part.length}`;
        if (r.truncated) res.note = '文件过大，只读取了前 16 MB';
        return res;
      },
      async vm_edit(a) {
        const p = abs(a.path, a.cwd); const nw = a.new_string == null ? '' : String(a.new_string);
        if (a.create) { await writeText(p, nw); const o = splitLines(nw); return { path: p, created: true, lines: o.lines.length, snippet: clip(numbered(o.lines.slice(0, 40), 1), 8000) }; }
        const k = await kind(p); if (k !== 'file') throw new Error((k === 'none' ? '文件不存在：' : '不是普通文件：') + p + (k === 'none' ? '（新建文件请设 create=true）' : ''));
        const text = await readText(p); const o = splitLines(text); const lines = o.lines.slice();
        if (a.start_line != null || a.insert_after_line != null) {
          const ins = splitLines(nw.endsWith('\n') ? nw : nw + '\n').lines; if (nw === '') ins.length = 0;
          let s, e;
          if (a.insert_after_line != null) { s = Math.floor(Number(a.insert_after_line)); if (!(s >= 0 && s <= lines.length)) throw new Error(`insert_after_line 超出范围（文件共 ${lines.length} 行）`); lines.splice(s, 0, ...ins); e = s + ins.length; }
          else { s = Math.floor(Number(a.start_line)); const en = Math.floor(Number(a.end_line == null ? a.start_line : a.end_line)); if (!(s >= 1 && en >= s - 1 && en <= lines.length)) throw new Error(`行号超出范围（文件共 ${lines.length} 行）`); lines.splice(s - 1, en - s + 1, ...ins); s = s - 1; e = s + ins.length; }
          await writeText(p, joinLines(o, lines));
          return { path: p, lines: lines.length, snippet: snippet(lines, s, e) };
        }
        if (a.old_string == null || a.old_string === '') throw new Error('请提供 old_string（字符串替换）或 start_line / insert_after_line（按行编辑），或 create=true');
        const body = o.crlf ? text.replace(/\r\n/g, '\n') : text; let old = String(a.old_string).replace(/\r\n/g, '\n'); let neu = nw.replace(/\r\n/g, '\n');
        let idx = body.indexOf(old), mode = 'exact';
        if (idx < 0) { // tolerate trailing-whitespace differences when old_string covers whole lines
          const tw = (x) => x.split('\n').map(y => y.trimEnd()).join('\n'); const b2 = tw(body), o2 = tw(old).replace(/\n$/, '');
          const j = o2 ? b2.indexOf(o2) : -1;
          if (j >= 0 && (j === 0 || b2[j - 1] === '\n') && (j + o2.length === b2.length || b2[j + o2.length] === '\n')) {
            const startLine = lineOf(b2, j), n = o2.split('\n').length; const bl = body.split('\n');
            old = bl.slice(startLine - 1, startLine - 1 + n).join('\n'); neu = neu.replace(/\n$/, ''); idx = body.indexOf(old); mode = 'whitespace';
          }
        }
        if (idx < 0) throw new Error('在文件中找不到 old_string。请先用 vm_view 查看当前内容并复制准确的文本（包括缩进） / old_string not found; view the file and copy the exact text');
        const count = body.split(old).length - 1;
        if (count > 1 && !a.replace_all) { const at = []; let k2 = -1; while ((k2 = body.indexOf(old, k2 + 1)) >= 0 && at.length < 10) at.push(lineOf(body, k2)); throw new Error(`old_string 出现了 ${count} 次（第 ${at.join('、')} 行）。请加入更多上下文使其唯一，或设 replace_all=true / not unique`); }
        const out = a.replace_all ? body.split(old).join(neu) : body.slice(0, idx) + neu + body.slice(idx + old.length);
        await writeText(p, o.crlf ? out.replace(/\n/g, '\r\n') : out);
        const nl = splitLines(out).lines; const s = lineOf(out, idx) - 1; const e = s + neu.split('\n').length;
        return { path: p, replaced: a.replace_all ? count : 1, match: mode, lines: nl.length, snippet: snippet(nl, s, e) };
      },
      async vm_apply_patch(a, ctx) {
        const cwd = a.cwd ? abs(a.cwd) : WORK; const text = String(a.patch || '');
        if (!/^\s*\*\*\* Begin Patch/.test(text)) {
          if (!/^(diff --git |--- |Index: )/m.test(text)) throw new Error('无法识别的补丁格式：请使用 "*** Begin Patch" 格式或统一 diff / unknown patch format');
          const f = '/tmp/aib-patch-' + Date.now() + '.diff'; await writeText(f, text.endsWith('\n') ? text : text + '\n');
          const r = await sh(`cd ${q(cwd)} && if command -v git >/dev/null 2>&1 && git apply --check --whitespace=nowarn ${f} 2>/dev/null; then git apply --whitespace=nowarn --verbose ${f}; else for p in 1 0; do if patch -p$p --dry-run -f < ${f} >/dev/null 2>&1; then patch -p$p -f < ${f}; exit $?; fi; done; echo "patch does not apply" >&2; exit 1; fi; s=$?; rm -f ${f}; exit $s`, { timeoutSec: 120 });
          if (r.code !== 0) throw new Error('补丁未能应用（没有修改任何文件）：' + clip(r.err || r.out, 3000));
          return { applied: true, format: 'unified', output: clip(r.out + r.err, 6000) };
        }
        const ops = parsePatch(text); if (!ops.length) throw new Error('补丁为空 / empty patch');
        const plan = [];
        for (const op of ops) { // validate everything first; nothing is written if any hunk fails
          const p = abs(op.path, cwd);
          if (op.type === 'add') { plan.push({ write: p, content: op.content, what: 'A ' + p }); continue; }
          const k = await kind(p);
          if (op.type === 'delete') { if (k !== 'file') throw new Error('要删除的文件不存在：' + p); plan.push({ del: p, what: 'D ' + p }); continue; }
          if (k !== 'file') throw new Error('要修改的文件不存在：' + p + '（新文件请用 *** Add File）');
          const out = op.hunks.length ? applyHunks(await readText(p), op.hunks, p) : await readText(p);
          if (op.moveTo) { const d = abs(op.moveTo, cwd); plan.push({ write: d, content: out, what: 'M ' + p + ' → ' + d }); plan.push({ del: p, quiet: true }); }
          else plan.push({ write: p, content: out, what: 'M ' + p });
        }
        for (const s of plan) { if (s.write) await writeText(s.write, s.content); else await sh(`rm -f ${q(s.del)}`, { timeoutSec: 30 }); }
        return { applied: true, format: 'codex', files: plan.filter(s => !s.quiet).map(s => s.what) };
      },
      async vm_search(a, ctx) {
        const p = a.path ? abs(a.path) : WORK; const max = Math.max(1, Math.min(2000, Math.floor(Number(a.max_results) || 200)));
        const C = Math.max(0, Math.min(5, Math.floor(Number(a.context) || 0))); const pat = String(a.pattern || ''); if (!pat) throw new Error('缺少 pattern');
        let cmd, engine;
        if (await hasRg(ctx)) {
          engine = 'ripgrep';
          cmd = `rg -n --no-heading --color never --max-columns 400 --max-columns-preview ${a.ignore_case ? '-i ' : ''}${a.fixed ? '-F ' : ''}${a.files_only ? '-l ' : ''}${C ? '-C ' + C + ' ' : ''}${a.glob ? '-g ' + q(a.glob) + ' ' : ''}-g '!.git' -g '!node_modules' -e ${q(pat)} ${q(p)}`;
        } else {
          engine = 'grep';
          const g = `grep $GI -n -H ${a.ignore_case ? '-i ' : ''}${a.fixed ? '-F ' : '-E '}${a.files_only ? '-l ' : ''}${C ? '-C ' + C + ' ' : ''}-e ${q(pat)}`;
          cmd = `GI=; echo x | grep -I x >/dev/null 2>&1 && GI=-I; if [ -f ${q(p)} ]; then ${g} ${q(p)}; else find ${q(p)} \\( -name .git -o -name node_modules -o -name __pycache__ \\) -prune -o -type f ${a.glob ? '-name ' + q(a.glob) + ' ' : ''}-print0 | xargs -0 -r ${g} 2>/dev/null; fi`;
        }
        const r = await sh(`( ${cmd} ) | head -n ${max + 1}`, { timeoutSec: 180 });
        const lines = r.out.split('\n').filter(Boolean); const truncated = lines.length > max;
        return { engine, path: p, matches: lines.length ? clip(lines.slice(0, max).join('\n'), 60000) : '', count: Math.min(lines.length, max), truncated, note: lines.length ? undefined : '没有匹配 / no matches' };
      },
      async vm_list(a) {
        const p = a.path ? abs(a.path) : WORK; const depth = Math.max(1, Math.min(8, Math.floor(Number(a.depth) || 2))); const max = Math.max(1, Math.min(3000, Math.floor(Number(a.max_entries) || 400)));
        const py = `import os,sys
root,depth,allx,mx=sys.argv[1],int(sys.argv[2]),sys.argv[3]=='1',int(sys.argv[4])
SKIP={'.git','node_modules','__pycache__','.venv','.mypy_cache','.pytest_cache'}
n=0
def fmt(s):
  for u in ('B','K','M','G'):
    if s<1024: return ('%d%s'%(s,u)) if u=='B' else ('%.1f%s'%(s,u))
    s/=1024.0
  return '%.1fT'%s
if not os.path.isdir(root): print('not a directory: '+root); sys.exit(2)
def walk(d,lvl):
  global n
  try: ents=sorted(os.scandir(d),key=lambda e:(not e.is_dir(follow_symlinks=False),e.name))
  except Exception as ex: print('  '*lvl+'[unreadable: %s]'%ex); return
  for e in ents:
    if not allx and (e.name.startswith('.') or e.name in SKIP): continue
    if n>=mx: print('… (more entries; raise max_entries or list a subdirectory)'); raise SystemExit
    n+=1
    if e.is_symlink(): print('  '*lvl+e.name+' -> '+os.readlink(e.path)); continue
    if e.is_dir():
      print('  '*lvl+e.name+'/')
      if lvl+1<depth: walk(e.path,lvl+1)
    else:
      try: print('  '*lvl+e.name+'  '+fmt(e.stat().st_size))
      except Exception: print('  '*lvl+e.name)
print(root.rstrip('/')+'/')
walk(root,1)
`;
        const r = await sh(`python3 - ${q(p)} ${depth + 1} ${a.all ? 1 : 0} ${max}`, { stdin: py, timeoutSec: 120 });
        if (r.code === 2) throw new Error('不是目录：' + p);
        if (r.code !== 0 && !r.out) throw new Error(clip(r.err, 2000) || '列出失败');
        return { path: p, tree: clip(r.out.replace(/\n$/, ''), 80000) };
      },
      async vm_bg(a) {
        const act = a.action;
        if (act === 'start') {
          if (!a.command) throw new Error('缺少 command');
          const id = 'j' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4); const d = `${JOBS}/${id}`;
          await io.write(d + '/cmd', enc(String(a.command) + '\n'));
          await io.write(d + '/meta', enc(JSON.stringify({ id, name: a.name || '', cwd: a.cwd || WORK, started: Date.now() })));
          const r = await sh(`mkdir -p ${q(a.cwd || WORK)} && cd ${q(a.cwd || WORK)} && setsid sh -c 'sh ${d}/cmd > ${d}/log 2>&1; echo $? > ${d}/exit' </dev/null >/dev/null 2>&1 & echo $! > ${d}/pid; cat ${d}/pid`, { timeoutSec: 30 });
          if (r.code !== 0) throw new Error('启动失败：' + clip(r.err, 2000));
          await new Promise(res => setTimeout(res, 800));
          const o = await sh(`tail -c 4000 ${d}/log 2>/dev/null; echo; cat ${d}/exit 2>/dev/null`, { timeoutSec: 30 });
          return { id, pid: Number(r.out.trim()) || null, started: true, note: '用 vm_bg output / wait / kill 并传 id=' + id, earlyOutput: clipTail(o.out.trim(), 4000) };
        }
        if (act === 'list') {
          const r = await sh(`for d in ${JOBS}/*/; do [ -d "$d" ] || continue; id=$(basename "$d"); p=$(cat "$d/pid" 2>/dev/null); if [ -f "$d/exit" ]; then st="exited $(cat "$d/exit")"; elif [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then st=running; else st=gone; fi; echo "$id|$p|$st|$(wc -c < "$d/log" 2>/dev/null)|$(cat "$d/meta" 2>/dev/null)|$(head -c 160 "$d/cmd" | tr '\\n' ' ')"; done`, { timeoutSec: 60 });
          const jobs = r.out.split('\n').filter(Boolean).map(l => { const [id, pid, state, bytes, meta, cmd] = l.split('|'); let m = {}; try { m = JSON.parse(meta); } catch {} return { id, pid: Number(pid) || null, state, logBytes: Number(bytes) || 0, name: m.name || '', started: m.started ? new Date(m.started).toISOString() : '', command: (cmd || '').trim() }; });
          return { jobs };
        }
        const id = String(a.id || ''); if (!/^j[a-z0-9]{3,12}$/.test(id)) throw new Error('缺少或无效的 id（先用 action=list 查看）');
        const d = `${JOBS}/${id}`;
        const state = async () => { const r = await sh(`[ -d ${d} ] || { echo missing; exit; }; p=$(cat ${d}/pid 2>/dev/null); if [ -f ${d}/exit ]; then echo "exited $(cat ${d}/exit)"; elif [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then echo running; else echo gone; fi; wc -c < ${d}/log`, { timeoutSec: 30 }); const [s, b] = r.out.trim().split('\n'); if (s === 'missing') throw new Error('没有这个任务：' + id); const m = /^exited (\d+)/.exec(s); return { state: m ? 'exited' : s, exitCode: m ? Number(m[1]) : null, logBytes: Number(b) || 0 }; };
        const output = async () => {
          if (a.since != null) { const since = Math.max(0, Math.floor(Number(a.since))); const r = await sh(`tail -c +${since + 1} ${d}/log | head -c 60000`, { timeoutSec: 30 }); const s = await state(); return Object.assign(s, { output: r.out, next: Math.min(s.logBytes, since + enc(r.out).length) }); }
          const n = Math.max(1, Math.min(2000, Math.floor(Number(a.tail) || 100))); const r = await sh(`tail -n ${n} ${d}/log`, { timeoutSec: 30 }); const s = await state(); return Object.assign(s, { output: clipTail(r.out, 60000), next: s.logBytes });
        };
        if (act === 'output') return output();
        if (act === 'wait') {
          const t = Math.max(1, Math.min(900, Math.floor(Number(a.timeoutSec) || 60)));
          await sh(`i=0; while [ ! -f ${d}/exit ] && [ $i -lt ${t * 2} ]; do p=$(cat ${d}/pid 2>/dev/null); [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null && break; sleep 0.5; i=$((i+1)); done`, { timeoutSec: t + 30 });
          const r = await output(); if (r.state === 'running') r.note = `${t} 秒内未结束，仍在运行 / still running`; return r;
        }
        if (act === 'kill') {
          await sh(`p=$(cat ${d}/pid 2>/dev/null); [ -n "$p" ] && { kill -TERM -$p 2>/dev/null || kill -TERM $p 2>/dev/null; i=0; while kill -0 $p 2>/dev/null && [ $i -lt 20 ]; do sleep 0.25; i=$((i+1)); done; kill -KILL -$p 2>/dev/null; }; [ -f ${d}/exit ] || echo killed > ${d}/exit; true`, { timeoutSec: 30 });
          return Object.assign({ killed: true }, await state());
        }
        throw new Error('未知 action：' + act);
      },
      async vm_pkg(a, ctx) {
        const act = a.action; const names = [].concat(a.packages || []).map(x => String(x).trim()).filter(Boolean).slice(0, 40);
        for (const n of names) if (!PKG.test(n)) throw new Error('包名不合法：' + n);
        let m = a.manager && a.manager !== 'auto' ? a.manager : await pkgManager();
        if (m === 'none') throw new Error('虚拟机中没有找到包管理器');
        if (['install', 'remove', 'info'].includes(act) && !names.length) throw new Error('请提供 packages');
        if (act === 'search' && !names.length) throw new Error('请提供搜索词');
        const N = names.map(q).join(' ');
        if (act === 'install' && io.network === false && io.offlineInstall) { // no network in the guest: the app downloads the packages
          ctx.status && ctx.status('正在由应用下载软件包…');
          return Object.assign({ manager: m, action: act }, await io.offlineInstall(m, names, { onOutput: ctx.stream, signal: ctx.signal }));
        }
        const C = {
          apk: { install: `apk add --no-progress ${N}`, remove: `apk del --no-progress ${N}`, search: `apk search -v ${q(names[0])} | head -n 60`, info: `apk info -a ${N} 2>&1 | head -n 80`, list: 'apk info -v 2>/dev/null | sort', update: 'apk update', upgrade: 'apk upgrade --no-progress' },
          apt: { install: `DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${N} || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${N}; }`, remove: `DEBIAN_FRONTEND=noninteractive apt-get remove -y ${N}`, search: `apt-cache search ${q(names[0])} | head -n 60`, info: `apt-cache show ${N} 2>&1 | head -n 80`, list: "dpkg-query -W -f='${Package} ${Version}\\n'", update: 'apt-get update', upgrade: 'DEBIAN_FRONTEND=noninteractive apt-get -y upgrade' },
          pip: { install: `pip install --no-input --progress-bar off ${N}`, remove: `pip uninstall -y ${N}`, search: `pip index versions ${q(names[0])} 2>&1 | head -n 20`, info: `pip show ${N}`, list: 'pip list --format=freeze', update: 'true', upgrade: `pip install --no-input --upgrade ${N || 'pip'}` },
          npm: { install: `npm install -g ${N}`, remove: `npm uninstall -g ${N}`, search: `npm search ${q(names[0])} 2>&1 | head -n 40`, info: `npm view ${N} name version description 2>&1 | head -n 60`, list: 'npm ls -g --depth=0', update: 'true', upgrade: `npm update -g ${N}` }
        }[m];
        if (!C || !C[act]) throw new Error('不支持的操作：' + m + ' ' + act);
        ctx.status && ctx.status(`正在执行 ${m} ${act}…`);
        const r = await io.sh(C[act], { timeoutSec: ['install', 'upgrade', 'update'].includes(act) ? 1800 : 300, signal: ctx.signal, onOutput: ctx.stream });
        if (act === 'install' && m !== 'pip' && m !== 'npm') rg = null;
        return { manager: m, action: act, packages: names, exitCode: r.exitCode, ok: r.exitCode === 0, output: clipTail((r.stdout || '') + (r.stderr ? '\n' + r.stderr : ''), act === 'list' ? 30000 : 8000) };
      },
      async vm_service(a) {
        const act = a.action; const name = a.name == null ? '' : String(a.name);
        if (act !== 'list' && !NAME.test(name)) throw new Error('服务名不合法（字母、数字、- _ .）');
        const mode = await svcMode();
        if (mode === 'systemd' || mode === 'openrc') {
          const unit = mode === 'systemd' ? `/etc/systemd/system/${name}.service` : `/etc/init.d/${name}`;
          if (act === 'create') {
            if (!a.command) throw new Error('缺少 command');
            const cwd = a.cwd || WORK;
            const body = mode === 'systemd'
              ? `[Unit]\nDescription=${name} (created by AI Browser)\nAfter=network-online.target\n\n[Service]\nWorkingDirectory=${cwd}\nExecStart=/bin/sh -c ${JSON.stringify(String(a.command))}\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=multi-user.target\n`
              : `#!/sbin/openrc-run\ndescription="${name} (created by AI Browser)"\ncommand=/bin/sh\ncommand_args="-c ${String(a.command).replace(/"/g, '\\"')}"\ndirectory="${cwd}"\ncommand_background=true\npidfile=/run/${name}.pid\noutput_log=/var/log/${name}.log\nerror_log=/var/log/${name}.log\nsupervisor=supervise-daemon\n`;
            await io.write(unit, enc(body)); await sh(`mkdir -p ${q(cwd)}; chmod 755 ${q(unit)}; ${mode === 'systemd' ? 'systemctl daemon-reload' : 'true'}`);
            return { service: name, created: true, manager: mode, unit, note: '用 action=start 启动，enable 设为开机启动' };
          }
          const S = mode === 'systemd'
            ? { list: "systemctl list-units --type=service --no-pager --no-legend | head -n 200", start: `systemctl start ${name}`, stop: `systemctl stop ${name}`, restart: `systemctl restart ${name}`, status: `systemctl status --no-pager ${name} | head -n 30`, enable: `systemctl enable ${name}`, disable: `systemctl disable ${name}`, logs: `journalctl -u ${name} --no-pager -n ${Math.min(2000, Number(a.lines) || 100)}`, remove: `systemctl disable --now ${name}; rm -f ${unit}; systemctl daemon-reload` }
            : { list: 'rc-status -a 2>&1 | head -n 200', start: `rc-service ${name} start`, stop: `rc-service ${name} stop`, restart: `rc-service ${name} restart`, status: `rc-service ${name} status`, enable: `rc-update add ${name} default`, disable: `rc-update del ${name} default`, logs: `tail -n ${Math.min(2000, Number(a.lines) || 100)} /var/log/${name}.log`, remove: `rc-service ${name} stop; rc-update del ${name} default; rm -f ${unit}` };
          const r = await sh(S[act], { timeoutSec: 120 });
          return { service: name || undefined, manager: mode, action: act, exitCode: r.code, output: clipTail(r.out + r.err, 20000) };
        }
        await ensureSvc();
        if (act === 'create') {
          if (!a.command) throw new Error('缺少 command');
          const d = `/persist/aib/services/${name}`;
          await io.write(d + '/cmd', enc(String(a.command) + '\n')); await io.write(d + '/cwd', enc(String(a.cwd || WORK)));
          await sh(`mkdir -p ${q(a.cwd || WORK)}`);
          return { service: name, created: true, manager: 'aib-svc', note: '用 action=start 启动，enable 设为虚拟机启动时自动运行；进程退出后会自动重启' };
        }
        const r = await sh(`${SVC} ${act} ${act === 'list' ? '' : q(name)} ${act === 'logs' ? Math.min(2000, Number(a.lines) || 100) : ''}`, { timeoutSec: 60 });
        if (act === 'start' || act === 'restart') { await new Promise(res => setTimeout(res, 1200)); const s = await sh(`${SVC} status ${q(name)}; ${SVC} logs ${q(name)} 20`, { timeoutSec: 30 }); return { service: name, manager: 'aib-svc', action: act, exitCode: r.code, output: clipTail(r.out + r.err, 4000), status: clipTail(s.out, 4000) }; }
        return { service: name || undefined, manager: 'aib-svc', action: act, exitCode: r.code, output: clipTail(r.out + r.err, 30000) };
      },
      async vm_git(a, ctx) {
        const args = [].concat(a.args || []).map(String); if (!args.length) throw new Error('缺少 args');
        if (args[0] === 'git') args.shift();
        const repo = a.repo ? abs(a.repo) : WORK;
        const cmd = `command -v git >/dev/null 2>&1 || { echo "git is not installed in this VM (vm_pkg install git)" >&2; exit 127; }; git config --global user.email >/dev/null 2>&1 || { git config --global user.email vm@aibrowser.local; git config --global user.name "AI Browser VM"; }; git config --global --get init.defaultBranch >/dev/null 2>&1 || git config --global init.defaultBranch main; mkdir -p ${q(repo)} && cd ${q(repo)} && GIT_TERMINAL_PROMPT=0 GIT_PAGER=cat PAGER=cat GIT_EDITOR=true git -c color.ui=never ${args.map(q).join(' ')}`;
        const r = await io.sh(cmd, { timeoutSec: Math.max(5, Math.min(7200, Number(a.timeoutSec) || 600)), signal: ctx.signal, onOutput: ctx.stream });
        return { repo, exitCode: r.exitCode, stdout: clipTail(r.stdout, 40000), stderr: clipTail(r.stderr, 8000) };
      }
    };
    async function call(name, a, ctx) { if (!run[name]) throw new Error('unknown tool: ' + name); return run[name](a || {}, ctx || {}); }
    return { call, has: (n) => !!run[n] };
  }
  // boot hook: start enabled aib-svc services after the VM is up (no-op when none are defined)
  const BOOT_CMD = `[ -x ${SVC} ] && ${SVC} boot >/dev/null 2>&1; true`;
  return { DEFS, LABELS, create, parsePatch, applyHunks, BOOT_CMD, SVC_SCRIPT, NAMES: DEFS.map(d => d.name) };
});
