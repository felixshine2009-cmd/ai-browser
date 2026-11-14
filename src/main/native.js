'use strict';
// Camera, text recognition, QR scanning and offline page copies (F1, B6, F4). On iPad these use the Swift host's
// native services (Native.swift: UIImagePickerController, Apple Vision, VisionKit DataScanner / AVFoundation, PDFKit,
// WKWebView web archives). On desktop, photos come from a file picker and pages are saved as MHTML.
const fs = require('fs');
const path = require('path');

function ipadNative() { try { const e = require('electron'); return (e.__ipad && e.__ipad.native) ? e.__ipad : null; } catch { return null; } }
const isIpad = () => !!ipadNative();

async function caps() {
  const n = ipadNative();
  if (!n) return { camera: false, dataScanner: false, ocr: false, pdf: false, desktop: true };
  try { return await n.native('caps', {}, 15000); } catch { return { camera: false }; }
}

/** photo from the camera (iPad) or an image file (desktop) -> { dataUrl, w, h, text?, cancelled? } */
async function capture({ ocr = false, source = 'camera', maxDim = 2048 } = {}) {
  const n = ipadNative();
  if (n) {
    const r = await n.native('camera', { ocr, source, maxDim, quality: 0.85 });
    if (!r || r.cancelled) return { cancelled: true };
    return { dataUrl: `data:${r.mime || 'image/jpeg'};base64,${r.b64}`, w: r.w, h: r.h, text: r.text || '', lines: r.lines || [] };
  }
  const { dialog } = require('electron');
  const res = await dialog.showOpenDialog({ title: '选择题目图片', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'heic', 'webp', 'gif'] }] });
  if (res.canceled || !res.filePaths.length) return { cancelled: true };
  const f = res.filePaths[0]; const ext = path.extname(f).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  return { dataUrl: `data:${mime};base64,${fs.readFileSync(f).toString('base64')}`, text: '' };
}

async function ocr(dataUrl) {
  const n = ipadNative(); if (!n) return { text: '', lines: [] };
  const b64 = String(dataUrl || '').replace(/^data:[^,]*,/, '');
  return n.native('ocr', { b64 }, 60000);
}

/** iPad: the glass tool popover under the toolbar button -> { id | null } (no time limit: it stays open until dismissed) */
async function toolsPopover(args) {
  const n = ipadNative();
  if (!n) return { unsupported: true };
  return n.native('toolsPopover', args || {}, 0);
}

/** QR code -> { text } | { cancelled } */
async function scanQr() {
  const n = ipadNative();
  if (!n) throw new Error('扫描二维码需要相机，仅 iPad 版支持');
  return n.native('qrscan', {});
}

/** offline copy of a page: web archive on iPad, MHTML on desktop -> { file, bytes, format } */
async function savePage(wc, dir, base) {
  fs.mkdirSync(dir, { recursive: true });
  const n = ipadNative();
  if (n) {
    const file = path.join(dir, base + '.webarchive');
    const r = await n.archive(wc.id, file);
    return { file, bytes: (r && r.bytes) || 0, format: 'webarchive' };
  }
  const file = path.join(dir, base + '.mhtml');
  await wc.savePage(file, 'MHTML');
  return { file, bytes: fs.statSync(file).size, format: 'mhtml' };
}

module.exports = { isIpad, caps, capture, ocr, scanQr, savePage, toolsPopover };
