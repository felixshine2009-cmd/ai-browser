'use strict';
// Host side of the guest-agent protocol (JSON lines over a stream: vfkit vsock unix socket / QEMU virtio port socket).
const net = require('net');
const { EventEmitter } = require('events');

class AgentClient extends EventEmitter {
  constructor(sockPath) { super(); this.sockPath = sockPath; this.seq = 0; this.pending = new Map(); this.buf = ''; this.sock = null; this.readyInfo = null; }
  connect({ timeoutMs = 120000, isAlive = () => true } = {}) {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (!isAlive()) return reject(new Error('虚拟机进程已退出'));
        if (Date.now() - t0 > timeoutMs) return reject(new Error('等待虚拟机响应超时'));
        const s = net.connect(this.sockPath);
        let settled = false;
        const fail = () => { if (settled) return; settled = true; s.destroy(); setTimeout(attempt, 500); };
        const readyTimer = setTimeout(fail, 8000); // vfkit accepts before the guest listens: wait for "ready"
        s.on('error', () => { clearTimeout(readyTimer); fail(); });
        s.on('close', () => { if (settled && this.sock === s) { this.sock = null; this._failAll(new Error('与虚拟机的连接已断开')); this.emit('close'); } else if (!settled) { clearTimeout(readyTimer); fail(); } });
        s.setEncoding('utf8');
        s.on('connect', () => { try { s.write(JSON.stringify({ id: 0, op: 'ping' }) + '\n'); } catch {} });
        s.on('data', (c) => {
          this.buf += c; let i;
          while ((i = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
            if (!line.startsWith('{')) continue;
            let j; try { j = JSON.parse(line); } catch { continue; }
            if (j.ev === 'ready' || (j.id === 0 && j.ev === 'result')) { if (j.id === 0) j = { ev: 'ready', info: j.info }; if (!settled) { settled = true; clearTimeout(readyTimer); this.sock = s; this.readyInfo = j; resolve(j); } continue; }
            this._dispatch(j);
          }
        });
      };
      attempt();
    });
  }
  _dispatch(j) {
    const p = this.pending.get(j.id); if (!p) return;
    if (j.ev === 'out') { if (p.onEvent) try { p.onEvent(j); } catch {} return; }
    this.pending.delete(j.id); p.resolve(j);
  }
  _failAll(e) { for (const p of this.pending.values()) p.reject(e); this.pending.clear(); }
  get connected() { return !!this.sock; }
  request(op, params = {}, { onEvent } = {}) {
    if (!this.sock) return Promise.reject(new Error('虚拟机未连接'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onEvent });
      this.sock.write(JSON.stringify(Object.assign({ id, op }, params)) + '\n');
    }).then((r) => Object.assign(r, { _id: id }));
  }
  // exec with streaming; returns {id, done: Promise}
  exec(cmd, opts = {}, onEvent) {
    if (!this.sock) throw new Error('虚拟机未连接');
    const id = ++this.seq;
    const done = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onEvent });
      this.sock.write(JSON.stringify(Object.assign({ id, op: 'exec', cmd }, opts)) + '\n');
    });
    return { id, done };
  }
  close() { try { this.sock && this.sock.destroy(); } catch {} this.sock = null; }
}

module.exports = { AgentClient };
