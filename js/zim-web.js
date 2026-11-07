(function (root) {
  'use strict';
  var archive = null;
  var fileName = '';
  var blobCache = new Map();
  var dec = new TextDecoder('utf-8');

  function fileRead(file) {
    return function (offset, length) {
      return file.slice(offset, offset + length).arrayBuffer().then(function (ab) {
        return new Uint8Array(ab);
      });
    };
  }

  async function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('此浏览器无法解压该 ZIM 文件');
    try {
      return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
    } catch (e) {
      return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    }
  }

  function zstd(u8) {
    if (!root.fzstd || !root.fzstd.decompress) throw new Error('缺少 zstd 解压组件');
    return root.fzstd.decompress(u8);
  }

  function resolvePath(from, href) {
    href = String(href || '').split('#')[0].split('?')[0];
    if (!href) return from;
    if (/^(https?:|data:|mailto:|javascript:|blob:)/i.test(href)) return href;
    if (href.charAt(0) === '/') return href.replace(/^\/+/, '');
    var parts = String(from || '').split('/');
    parts.pop();
    href.split('/').forEach(function (seg) {
      if (!seg || seg === '.') return;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    });
    return parts.join('/');
  }

  async function blobFor(path, mime) {
    if (blobCache.has(path)) return blobCache.get(path);
    var item = await archive.getByPath(path);
    if (!item || !item.data) return '';
    var type = mime || item.mime || 'application/octet-stream';
    var url = URL.createObjectURL(new Blob([item.data], { type: type }));
    blobCache.set(path, url);
    return url;
  }

  async function rewriteCss(text, fromPath) {
    var re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    var out = '', last = 0, m;
    var jobs = [];
    while ((m = re.exec(text))) jobs.push(m);
    for (var i = 0; i < jobs.length; i++) {
      var match = jobs[i];
      out += text.slice(last, match.index);
      last = match.index + match[0].length;
      var href = match[2];
      if (/^(https?:|data:|blob:)/i.test(href)) { out += match[0]; continue; }
      var target = resolvePath(fromPath, href);
      var url = await blobFor(target);
      out += url ? ('url("' + url + '")') : match[0];
    }
    return out + text.slice(last);
  }

  async function rewriteHtml(html, fromPath) {
    var re = /\s(src|href)=(["'])([^"']+)\2/gi;
    var out = '', last = 0, m;
    var jobs = [];
    while ((m = re.exec(html))) jobs.push({ index: m.index, full: m[0], attr: m[1], q: m[2], href: m[3], end: m.index + m[0].length });
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      out += html.slice(last, job.index);
      last = job.end;
      if (/^(https?:|data:|mailto:|javascript:|blob:)/i.test(job.href) || job.href.charAt(0) === '#') {
        out += job.full;
        continue;
      }
      var target = resolvePath(fromPath, job.href);
      var lower = target.toLowerCase();
      if (/\.(css)(?:$|\?)/.test(lower) || job.attr.toLowerCase() === 'href' && /\.css/i.test(job.href)) {
        var cssItem = await archive.getByPath(target);
        if (cssItem && cssItem.data) {
          var cssText = await rewriteCss(dec.decode(cssItem.data), target);
          var cssUrl = URL.createObjectURL(new Blob([cssText], { type: 'text/css' }));
          blobCache.set(target, cssUrl);
          out += ' ' + job.attr + '=' + job.q + cssUrl + job.q;
          continue;
        }
      }
      if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp[34]|ogg|webm|wasm)(?:$|\?)/i.test(lower) || job.attr.toLowerCase() === 'src') {
        var url = await blobFor(target);
        if (url) { out += ' ' + job.attr + '=' + job.q + url + job.q; continue; }
      }
      out += ' ' + job.attr + '=' + job.q + job.href + job.q + ' data-zim-path=' + job.q + target + job.q;
    }
    return out + html.slice(last);
  }

  var copied = false;

  async function copyToAppDir(file) {
    if (!file || !navigator.storage || !navigator.storage.getDirectory) return { file: file, copied: false };
    var rootDir = await navigator.storage.getDirectory();
    var dir = await rootDir.getDirectoryHandle('zims', { create: true });
    var fh = await dir.getFileHandle(file.name, { create: true });
    var w = await fh.createWritable();
    await file.stream().pipeTo(w);
    try { localStorage.setItem('aibWikiZimName', file.name); } catch (e) {}
    return { file: await fh.getFile(), copied: true };
  }

  async function restoreFile() {
    try {
      var name = localStorage.getItem('aibWikiZimName');
      if (!name || !navigator.storage || !navigator.storage.getDirectory) return null;
      var rootDir = await navigator.storage.getDirectory();
      var dir = await rootDir.getDirectoryHandle('zims');
      var fh = await dir.getFileHandle(name);
      return fh.getFile();
    } catch (e) { return null; }
  }

  root.AibZim = {
    async open(file, opts) {
      opts = opts || {};
      var used = file;
      copied = false;
      if (!opts.skipCopy) {
        try {
          var saved = await copyToAppDir(file);
          used = saved.file || file;
          copied = !!saved.copied;
        } catch (e) {
          used = file;
          copied = false;
        }
      } else {
        copied = !!opts.copied;
      }
      blobCache.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
      blobCache.clear();
      archive = new root.ZimReader.ZimArchive(fileRead(used), { inflate: inflate, zstd: zstd });
      await archive.init();
      fileName = used.name || file.name || '';
      return root.AibZim.status();
    },
    async restore() {
      var file = await restoreFile();
      if (!file) return { open: false };
      return root.AibZim.open(file, { skipCopy: true, copied: true });
    },
    status() {
      if (!archive) return { open: false, name: '', articleCount: 0, copied: false, error: '' };
      return { open: true, name: fileName, articleCount: archive.entryCount, copied: copied, error: '' };
    },
    search(q, limit) { return archive ? archive.search(q, limit || 20) : Promise.resolve([]); },
    getByPath(p) { return archive ? archive.getByPath(p) : Promise.resolve(null); },
    mainEntry() { return archive ? archive.mainEntry() : Promise.resolve(null); },
    async render(path) {
      var item = path ? await archive.getByPath(path) : await archive.mainEntry();
      if (!item) return null;
      var mime = item.mime || '';
      if (mime.indexOf('html') >= 0 || mime.indexOf('text/') === 0) {
        var html = await rewriteHtml(dec.decode(item.data), item.path);
        return { title: item.title, path: item.path, mime: mime, html: html };
      }
      return { title: item.title, path: item.path, mime: mime, url: await blobFor(item.path, mime) };
    },
    resolvePath: resolvePath
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
