'use strict';
const http = require('http');
const os = require('os');
const v36 = require('./v36');

function lanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return '127.0.0.1';
}

function createPhoneServer({ onImage } = {}) {
  const token = Math.random().toString(36).slice(2, 10);
  const html = v36.phonePage();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/c/' + token) { res.writeHead(404); return res.end('not found'); }
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
    if (req.method === 'POST') {
      const chunks = []; let size = 0;
      req.on('data', c => { size += c.length; if (size > 8_000_000) req.destroy(); else chunks.push(c); });
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        try { if (onImage) onImage(buf); } catch {}
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('ok');
      });
      return;
    }
    res.writeHead(405); res.end('no');
  });
  return {
    token, server,
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '0.0.0.0', () => {
          const port = server.address().port;
          const url = `http://${lanIp()}:${port}/c/${token}`;
          resolve({ port, url, qr: v36.qrSvg(url) });
        });
      });
    },
    stop() { return new Promise(r => server.close(() => r())); }
  };
}

module.exports = { createPhoneServer, lanIp };
