'use strict';
// Every process a test spawns (Electron app, iPad simulator, servers) is registered here and killed with its whole
// process group when the test run exits, is interrupted or crashes, so nothing keeps running (and logging) afterwards.
// Spawn with { detached: true } so the child leads its own process group (grandchildren such as the simulator's Node.js
// runtime are killed with it).
const live = new Set();
function killTree(p, sig = 'SIGKILL') {
  if (!p || p.exitCode !== null || p.signalCode) { if (p && p.pid) { try { process.kill(-p.pid, sig); } catch {} } return; }
  try { process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch {} }
}
function track(p) {
  live.add(p);
  p.on('exit', () => { live.delete(p); try { process.kill(-p.pid, 'SIGKILL'); } catch {} }); // leftover grandchildren
  return p;
}
function killAll() { for (const p of live) killTree(p); live.clear(); }
let installed = false;
function install() {
  if (installed) return; installed = true;
  process.on('exit', killAll);
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { killAll(); process.exit(130); });
  process.on('uncaughtException', (e) => { try { console.error(e); } catch {} killAll(); process.exit(1); });
}
install();
module.exports = { track, killTree, killAll, live };
