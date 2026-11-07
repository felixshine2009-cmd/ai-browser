/* OpenZIM reader (format v5/v6). Random-access; does not load the whole file. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZimReader = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAGIC = 72173914;
  var NO_TITLE = 0xFFFFFFFFFFFFFFFF;
  var enc = new TextEncoder();
  var dec = new TextDecoder('utf-8');

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function u64(b, o) { return u32(b, o + 4) * 4294967296 + u32(b, o); }
  function cstr(b, o) {
    var e = o;
    while (e < b.length && b[e] !== 0) e++;
    return { s: dec.decode(b.subarray(o, e)), n: e + 1 };
  }
  function utf8Cmp(a, b) {
    var ae = enc.encode(String(a)), be = enc.encode(String(b));
    var n = Math.min(ae.length, be.length);
    for (var i = 0; i < n; i++) if (ae[i] !== be[i]) return ae[i] - be[i];
    return ae.length - be.length;
  }
  function variants(q) {
    var s = String(q || '').trim();
    if (!s) return [];
    var u = s.replace(/ /g, '_');
    var cap = u.charAt(0).toUpperCase() + u.slice(1);
    var low = u.charAt(0).toLowerCase() + u.slice(1);
    var out = [s, u, cap, low];
    var uniq = [], seen = {};
    out.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; uniq.push(x); } });
    return uniq;
  }

  function ZimArchive(read, codecs) {
    this._read = read;
    this._codecs = codecs || {};
    this._clusterCache = new Map();
    this._entryCache = new Map();
  }

  ZimArchive.prototype.init = async function () {
    var hdr = await this._read(0, 80);
    if (hdr.length < 80 || u32(hdr, 0) !== MAGIC) throw new Error('不是有效的 ZIM 文件');
    this.major = u16(hdr, 4);
    this.minor = u16(hdr, 6);
    this.entryCount = u32(hdr, 24);
    this.clusterCount = u32(hdr, 28);
    this.urlPtrPos = u64(hdr, 32);
    this.titlePtrPos = u64(hdr, 40);
    this.clusterPtrPos = u64(hdr, 48);
    this.mimeListPos = u64(hdr, 56);
    this.mainPage = u32(hdr, 64);
    this.layoutPage = u32(hdr, 68);
    this.checksumPos = u64(hdr, 72);
    this.hasTitlePtr = this.titlePtrPos > 0 && this.titlePtrPos !== NO_TITLE;
    var mimeLen = 16384;
    if (this.urlPtrPos > this.mimeListPos) mimeLen = Math.min(mimeLen, this.urlPtrPos - this.mimeListPos);
    var mimeBuf = await this._read(this.mimeListPos, mimeLen);
    this.mimes = [];
    var i = 0;
    while (i < mimeBuf.length) {
      var r = cstr(mimeBuf, i);
      if (!r.s) break;
      this.mimes.push(r.s);
      i = r.n;
    }
    return this;
  };

  ZimArchive.prototype._u64At = async function (pos) {
    return u64(await this._read(pos, 8), 0);
  };
  ZimArchive.prototype._u32At = async function (pos) {
    return u32(await this._read(pos, 4), 0);
  };
  ZimArchive.prototype.urlPtr = function (i) { return this._u64At(this.urlPtrPos + i * 8); };
  ZimArchive.prototype.titleIndex = function (rank) { return this._u32At(this.titlePtrPos + rank * 4); };
  ZimArchive.prototype.clusterPtr = function (i) { return this._u64At(this.clusterPtrPos + i * 8); };

  ZimArchive.prototype.pathKey = function (e) {
    if (!e) return '';
    if (this.major >= 6 || (e.url && e.url.indexOf('/') >= 0)) return e.url;
    return (e.ns || '') + '/' + (e.url || '');
  };
  ZimArchive.prototype.titleSortKey = function (e) {
    var t = e.title || e.url || '';
    if (this.major >= 6) return t;
    return (e.ns || '') + t;
  };

  ZimArchive.prototype.readEntryByIndex = async function (i) {
    if (i < 0 || i >= this.entryCount) return null;
    if (this._entryCache.has(i)) return this._entryCache.get(i);
    var off = await this.urlPtr(i);
    var e = await this.readEntryAt(off, i);
    this._entryCache.set(i, e);
    if (this._entryCache.size > 5000) this._entryCache.delete(this._entryCache.keys().next().value);
    return e;
  };

  ZimArchive.prototype.readEntryAt = async function (off, index) {
    var buf = await this._read(off, 1536);
    if (buf.length < 16) buf = await this._read(off, 4096);
    var mimetype = u16(buf, 0);
    var ns = String.fromCharCode(buf[3]);
    var redirectIndex = null, clusterNumber = null, blobNumber = null, p = 8;
    if (mimetype === 0xffff) { redirectIndex = u32(buf, 8); p = 12; }
    else if (mimetype === 0xfffe || mimetype === 0xfffd) { p = 8; }
    else { clusterNumber = u32(buf, 8); blobNumber = u32(buf, 12); p = 16; }
    var urlR = cstr(buf, p);
    var titleR = cstr(buf, urlR.n);
    var url = urlR.s;
    var title = titleR.s || url;
    var path = (this.major >= 6 || (url && url.indexOf('/') >= 0)) ? url : ((ns && ns !== '\0') ? (ns + '/' + url) : url);
    return {
      index: index,
      mimetype: mimetype,
      ns: ns,
      url: url,
      title: title,
      path: path,
      redirectIndex: redirectIndex,
      clusterNumber: clusterNumber,
      blobNumber: blobNumber,
      mime: (mimetype < this.mimes.length) ? this.mimes[mimetype] : '',
      isRedirect: mimetype === 0xffff
    };
  };

  ZimArchive.prototype.follow = async function (entry) {
    var guard = 0;
    while (entry && entry.isRedirect && entry.redirectIndex != null && guard++ < 10) {
      entry = await this.readEntryByIndex(entry.redirectIndex);
    }
    return entry;
  };

  ZimArchive.prototype.decompressCluster = async function (n) {
    if (this._clusterCache.has(n)) return this._clusterCache.get(n);
    var start = await this.clusterPtr(n);
    var end = (n + 1 < this.clusterCount) ? await this.clusterPtr(n + 1) : this.checksumPos;
    var size = end - start;
    if (size <= 0) throw new Error('压缩簇无效');
    if (size > 96 * 1024 * 1024) throw new Error('压缩簇过大');
    var packed = await this._read(start, size);
    var info = packed[0];
    var ctype = info & 0x0f;
    var extended = !!(info & 0x10);
    var payload = packed.subarray(1);
    var data;
    if (ctype <= 1) data = payload;
    else if (ctype === 2) {
      if (!this._codecs.inflate) throw new Error('缺少 zlib 解压');
      data = await Promise.resolve(this._codecs.inflate(payload));
    } else if (ctype === 5) {
      if (!this._codecs.zstd) throw new Error('缺少 zstd 解压');
      data = await Promise.resolve(this._codecs.zstd(payload));
    } else if (ctype === 4) {
      if (!this._codecs.lzma) throw new Error('该 ZIM 文件使用 LZMA 压缩，目前无法读取其中的内容');
      data = await Promise.resolve(this._codecs.lzma(payload));
    } else throw new Error('不支持的 ZIM 压缩类型：' + ctype);
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    var rec = { data: data, extended: extended };
    this._clusterCache.set(n, rec);
    if (this._clusterCache.size > 6) this._clusterCache.delete(this._clusterCache.keys().next().value);
    return rec;
  };

  ZimArchive.prototype.readBlob = async function (clusterNumber, blobNumber) {
    var raw = await this.decompressCluster(clusterNumber);
    var data = raw.data;
    var osz = raw.extended ? 8 : 4;
    var first = raw.extended ? u64(data, 0) : u32(data, 0);
    var count = Math.floor(first / osz) - 1;
    if (blobNumber < 0 || blobNumber >= count) throw new Error('内容块超出范围');
    var start = raw.extended ? u64(data, blobNumber * osz) : u32(data, blobNumber * osz);
    var end = raw.extended ? u64(data, (blobNumber + 1) * osz) : u32(data, (blobNumber + 1) * osz);
    return data.subarray(start, end);
  };

  ZimArchive.prototype.materialize = async function (entry) {
    entry = await this.follow(entry);
    if (!entry) return null;
    if (entry.isRedirect || entry.clusterNumber == null) return entry;
    var data = await this.readBlob(entry.clusterNumber, entry.blobNumber);
    var out = {};
    Object.keys(entry).forEach(function (k) { out[k] = entry[k]; });
    out.data = data;
    out.mime = entry.mime || 'application/octet-stream';
    return out;
  };

  ZimArchive.prototype.lookupUrl = async function (want) {
    var lo = 0, hi = this.entryCount - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      var e = await this.readEntryByIndex(mid);
      var c = utf8Cmp(this.pathKey(e), want);
      if (c === 0) return e;
      if (c < 0) lo = mid + 1; else hi = mid - 1;
    }
    return null;
  };

  ZimArchive.prototype.getByIndex = async function (i) {
    return this.materialize(await this.readEntryByIndex(i));
  };

  ZimArchive.prototype.mainEntry = async function () {
    if (this.mainPage !== 0xffffffff) return this.getByIndex(this.mainPage);
    return null;
  };

  ZimArchive.prototype.getByPath = async function (path) {
    var want = decodeURIComponent(String(path || '').replace(/^\/+/, ''));
    if (!want) return this.mainEntry();
    var cands = [want];
    if (want.indexOf('/') < 0) {
      cands.push('A/' + want, 'A/' + want.replace(/ /g, '_'), 'C/' + want, 'I/' + want);
    }
    var i;
    for (i = 0; i < cands.length; i++) {
      var hit = await this.lookupUrl(cands[i]);
      if (hit) return this.materialize(hit);
    }
    var listed = await this.search(want, 8);
    for (i = 0; i < listed.length; i++) {
      if ((listed[i].title || '').toLowerCase() === want.toLowerCase() || listed[i].url === want || listed[i].path === want) {
        return this.materialize(listed[i]);
      }
    }
    return null;
  };

  ZimArchive.prototype._entryAtTitleRank = async function (rank) {
    var idx = this.hasTitlePtr ? await this.titleIndex(rank) : rank;
    return this.readEntryByIndex(idx);
  };

  ZimArchive.prototype.firstPrefix = async function (prefix, keyFn) {
    var lo = 0, hi = this.entryCount;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      var e = await this._entryAtTitleRank(mid);
      if (utf8Cmp(keyFn(e), prefix) < 0) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  ZimArchive.prototype.firstPrefixUrl = async function (prefix) {
    var lo = 0, hi = this.entryCount;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      var e = await this.readEntryByIndex(mid);
      if (utf8Cmp(this.pathKey(e), prefix) < 0) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  ZimArchive.prototype.search = async function (q, limit) {
    limit = limit || 20;
    q = String(q || '').trim();
    if (!q) return [];
    var self = this, out = [], seen = {};
    function add(e) {
      if (!e || seen[e.index] || e.mimetype === 0xfffe || e.mimetype === 0xfffd) return;
      if (e.ns === 'M' || e.ns === 'X' || e.ns === 'W') return;
      if (e.mime && e.mime.indexOf('html') < 0 && !/^text\/(plain|css)/.test(e.mime) && e.ns !== 'A') return;
      if (e.mime && e.mime.indexOf('image/') === 0) return;
      seen[e.index] = 1;
      out.push(e);
    }
    var vars = variants(q);
    var titlePrefs = vars.slice();
    if (this.major < 6) vars.forEach(function (v) { titlePrefs.push('A' + v, 'C' + v); });
    var pathPrefs = vars.slice();
    vars.forEach(function (v) { pathPrefs.push('A/' + v, 'C/' + v, 'I/' + v); });
    var vi, r, prefix, from, e, key;
    var titleKey = function (ent) { return self.titleSortKey(ent); };
    for (vi = 0; vi < titlePrefs.length && out.length < limit; vi++) {
      prefix = titlePrefs[vi];
      from = await this.firstPrefix(prefix, titleKey);
      for (r = from; r < this.entryCount && out.length < limit; r++) {
        e = await this._entryAtTitleRank(r);
        key = titleKey(e);
        if (key.slice(0, prefix.length) !== prefix) {
          if (utf8Cmp(key, prefix) > 0) break;
          continue;
        }
        add(e);
      }
    }
    for (vi = 0; vi < pathPrefs.length && out.length < limit; vi++) {
      prefix = pathPrefs[vi];
      from = await this.firstPrefixUrl(prefix);
      for (r = from; r < this.entryCount && out.length < limit; r++) {
        e = await this.readEntryByIndex(r);
        key = this.pathKey(e);
        if (key.slice(0, prefix.length) !== prefix) {
          if (utf8Cmp(key, prefix) > 0) break;
          continue;
        }
        add(e);
      }
    }
    if (out.length < limit && this.entryCount <= 15000) {
      var ql = q.toLowerCase();
      for (r = 0; r < this.entryCount && out.length < limit; r++) {
        var e2 = await this.readEntryByIndex(r);
        var blob = ((e2.title || '') + ' ' + (e2.url || '') + ' ' + (e2.path || '')).toLowerCase();
        if (blob.indexOf(ql) >= 0) add(e2);
      }
    }
    return out.slice(0, limit);
  };

  return { ZimArchive: ZimArchive, utf8Cmp: utf8Cmp };
});
