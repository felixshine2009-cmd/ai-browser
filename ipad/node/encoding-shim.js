'use strict';
// TextDecoder for every WHATWG encoding on iOS.
// nodejs-mobile is built without ICU (v8_enable_i18n_support = 0, like `configure --with-intl=none`). Its TextDecoder
// then only knows utf-8 and utf-16le and rejects the "fatal" option, so e.g. `new TextDecoder('big5')` or
// `new TextDecoder('gb18030')` throws ERR_ENCODING_NOT_SUPPORTED, and modules that create such decoders at load time
// (js-mdict: MDX dictionaries in BIG5 / GB18030) failed to load at all, which took the whole main process down.
// This wraps the global TextDecoder (and util.TextDecoder): labels the native decoder accepts keep using it; any other
// label, or the "fatal" option, is decoded in pure JavaScript with iconv-lite (MIT). Decoders are created lazily, so
// constructing one never loads code tables until something is actually decoded. A no-op where ICU is present.
const util = require('util');
const NativeTD = globalThis.TextDecoder;

// WHATWG Encoding Standard labels -> canonical name (the encodings people actually meet; iconv-lite knows all of them)
const GROUPS = {
  'utf-8': ['unicode-1-1-utf-8', 'unicode11utf8', 'unicode20utf8', 'utf8', 'x-unicode20utf8'],
  'utf-16le': ['csunicode', 'iso-10646-ucs-2', 'ucs-2', 'unicode', 'unicodefeff', 'utf-16'],
  'utf-16be': ['unicodefffe'],
  'big5': ['big5-hkscs', 'cn-big5', 'csbig5', 'x-x-big5'],
  'gbk': ['chinese', 'csgb2312', 'csiso58gb231280', 'gb2312', 'gb_2312', 'gb_2312-80', 'iso-ir-58', 'x-gbk'],
  'gb18030': [],
  'shift_jis': ['csshiftjis', 'ms932', 'ms_kanji', 'shift-jis', 'sjis', 'windows-31j', 'x-sjis'],
  'euc-jp': ['cseucpkdfmtjapanese', 'x-euc-jp'],
  'euc-kr': ['cseuckr', 'csksc56011987', 'iso-ir-149', 'korean', 'ks_c_5601-1987', 'ks_c_5601-1989', 'ksc5601', 'ksc_5601', 'windows-949'],
  'windows-1252': ['ansi_x3.4-1968', 'ascii', 'cp1252', 'cp819', 'csisolatin1', 'ibm819', 'iso-8859-1', 'iso-ir-100', 'iso8859-1', 'iso88591', 'iso_8859-1', 'iso_8859-1:1987', 'l1', 'latin1', 'us-ascii', 'x-cp1252'],
  'windows-1250': ['cp1250', 'x-cp1250'], 'windows-1251': ['cp1251', 'x-cp1251'], 'windows-1253': ['cp1253', 'x-cp1253'],
  'windows-1254': ['cp1254', 'csisolatin5', 'iso-8859-9', 'iso-ir-148', 'iso8859-9', 'iso88599', 'iso_8859-9', 'l5', 'latin5', 'x-cp1254'],
  'windows-1255': ['cp1255', 'x-cp1255'], 'windows-1256': ['cp1256', 'x-cp1256'], 'windows-1257': ['cp1257', 'x-cp1257'],
  'windows-1258': ['cp1258', 'x-cp1258'], 'windows-874': ['dos-874', 'iso-8859-11', 'iso8859-11', 'iso885911', 'tis-620'],
  'iso-8859-2': ['csisolatin2', 'iso-ir-101', 'iso8859-2', 'iso88592', 'iso_8859-2', 'l2', 'latin2'],
  'iso-8859-3': ['csisolatin3', 'iso8859-3', 'iso88593', 'iso_8859-3', 'l3', 'latin3'],
  'iso-8859-4': ['csisolatin4', 'iso8859-4', 'iso88594', 'iso_8859-4', 'l4', 'latin4'],
  'iso-8859-5': ['csisolatincyrillic', 'cyrillic', 'iso8859-5', 'iso88595', 'iso_8859-5'],
  'iso-8859-6': ['arabic', 'csisolatinarabic', 'iso8859-6', 'iso88596', 'iso_8859-6'],
  'iso-8859-7': ['csisolatingreek', 'greek', 'greek8', 'iso8859-7', 'iso88597', 'iso_8859-7', 'sun_eu_greek'],
  'iso-8859-8': ['csisolatinhebrew', 'hebrew', 'iso8859-8', 'iso88598', 'iso_8859-8', 'visual'],
  'iso-8859-10': ['csisolatin6', 'iso8859-10', 'iso885910', 'l6', 'latin6'],
  'iso-8859-13': ['iso8859-13', 'iso885913'], 'iso-8859-14': ['iso8859-14', 'iso885914'],
  'iso-8859-15': ['csisolatin9', 'iso8859-15', 'iso885915', 'iso_8859-15', 'l9'], 'iso-8859-16': [],
  'koi8-r': ['cskoi8r', 'koi', 'koi8', 'koi8_r'], 'koi8-u': ['koi8-ru'],
  'macintosh': ['csmacintosh', 'mac', 'x-mac-roman'], 'x-mac-cyrillic': ['x-mac-ukrainian'], 'ibm866': ['866', 'cp866', 'csibm866'],
};
const LABELS = new Map();
for (const [name, alts] of Object.entries(GROUPS)) { LABELS.set(name, name); for (const a of alts) LABELS.set(a, name); }
const canonical = (label) => { const l = String(label).trim().toLowerCase(); return LABELS.get(l) || l; };
const ICONV_NAME = { 'x-mac-cyrillic': 'maccyrillic', 'ibm866': 'cp866' };

let iconv = null;
function lazyIconv() {
  if (!iconv) iconv = require('iconv-lite');
  return iconv;
}

function nativeOk(label, options) {
  if (typeof NativeTD !== 'function') return false;
  try { new NativeTD(label, options); return true; } catch { return false; }
}

function toBuffer(input) {
  if (input === undefined || input === null) return Buffer.alloc(0);
  if (input instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && input instanceof SharedArrayBuffer)) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const e = new TypeError('The "input" argument must be an instance of ArrayBuffer or ArrayBufferView');
  e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
}
function invalidData(enc) {
  const e = new TypeError(`The encoded data was not valid for encoding ${enc}`);
  e.code = 'ERR_ENCODING_INVALID_ENCODED_DATA'; return e;
}
// length of the incomplete UTF-8 sequence at the end of b (0 when it ends on a character boundary)
function utf8Tail(b) {
  for (let k = 1; k <= Math.min(3, b.length); k++) {
    const c = b[b.length - k];
    if ((c & 0xc0) === 0x80) continue; // continuation byte
    const need = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1;
    return need > k ? k : 0;
  }
  return 0;
}
const isUtf8 = require('buffer').isUtf8;

class TextDecoder {
  constructor(label = 'utf-8', options = {}) {
    if (options === null || options === undefined) options = {};
    const enc = canonical(label);
    const fatal = !!options.fatal, ignoreBOM = !!options.ignoreBOM;
    let mode;
    if (!fatal && nativeOk(label, { ignoreBOM })) mode = 'native';
    else if (enc === 'utf-8' && fatal && typeof isUtf8 === 'function' && nativeOk('utf-8', { ignoreBOM })) mode = 'utf8-fatal';
    else if (enc === 'utf-16le' && fatal) mode = 'iconv';
    else if (LABELS.has(enc) || lazyIconv().encodingExists(ICONV_NAME[enc] || enc)) mode = 'iconv';
    else {
      const e = new RangeError(`The "${label}" encoding is not supported`);
      e.code = 'ERR_ENCODING_NOT_SUPPORTED'; throw e;
    }
    Object.defineProperties(this, {
      _enc: { value: enc }, _fatal: { value: fatal }, _ignoreBOM: { value: ignoreBOM }, _mode: { value: mode },
      _native: { value: mode === 'iconv' ? null : new NativeTD(label, { ignoreBOM }), writable: true },
      _dec: { value: null, writable: true }, _pending: { value: null, writable: true },
    });
  }
  get encoding() { return this._enc; }
  get fatal() { return this._fatal; }
  get ignoreBOM() { return this._ignoreBOM; }
  decode(input, options = {}) {
    const stream = !!(options && options.stream);
    if (this._mode === 'native') return this._native.decode(input, { stream });
    let buf = toBuffer(input);
    if (this._mode === 'utf8-fatal') {
      if (this._pending) { buf = Buffer.concat([this._pending, buf]); this._pending = null; }
      const tail = stream ? utf8Tail(buf) : 0;
      const body = tail ? buf.subarray(0, buf.length - tail) : buf;
      if (!isUtf8(body)) { this._native = new NativeTD('utf-8', { ignoreBOM: this._ignoreBOM }); throw invalidData(this._enc); }
      if (tail) this._pending = Buffer.from(buf.subarray(buf.length - tail));
      return this._native.decode(body, { stream });
    }
    const ic = lazyIconv();
    if (!this._dec) this._dec = ic.getDecoder(ICONV_NAME[this._enc] || this._enc, { stripBOM: !this._ignoreBOM });
    let out = this._dec.write(buf);
    if (!stream) { out += this._dec.end() || ''; this._dec = null; }
    if (this._fatal && out.includes('\ufffd')) { this._dec = null; throw invalidData(this._enc); }
    return out;
  }
  get [Symbol.toStringTag]() { return 'TextDecoder'; }
}

function probe() { try { new NativeTD('big5'); return true; } catch { return false; } }
if (!probe()) {
  Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, writable: true, configurable: true, enumerable: false });
  try { util.TextDecoder = TextDecoder; } catch {}
  TextDecoder.__aibPolyfill = true;
}
module.exports = { TextDecoder, NativeTextDecoder: NativeTD, canonical };
