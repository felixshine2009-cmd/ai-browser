#!/usr/bin/env node
'use strict';
// Cross-platform test runner: xvfb only on Linux (headless CI). macOS / Windows run Electron natively.
const { spawnSync } = require('child_process');
const path = require('path');
const args = process.argv.slice(2);
const nodeArgs = [path.join(__dirname, '..', 'test', 'run-all.js'), ...args];
const env = { ...process.env };
let cmd, cmdArgs;
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.AIB_NO_XVFB) {
  cmd = 'xvfb-run'; cmdArgs = ['-a', '-s', '-screen 0 1440x900x24', 'node', ...nodeArgs];
} else if (process.platform === 'linux' && !process.env.AIB_NO_XVFB && process.env.AIB_FORCE_XVFB) {
  cmd = 'xvfb-run'; cmdArgs = ['-a', '-s', '-screen 0 1440x900x24', 'node', ...nodeArgs];
} else if (process.platform === 'linux' && !process.env.AIB_NO_XVFB) {
  // DISPLAY is set (e.g. already under xvfb or a real session) — still wrap for CI convenience unless AIB_NO_XVFB
  cmd = 'xvfb-run'; cmdArgs = ['-a', '-s', '-screen 0 1440x900x24', 'node', ...nodeArgs];
} else {
  cmd = process.execPath; cmdArgs = nodeArgs;
}
if (process.platform !== 'linux') { cmd = process.execPath; cmdArgs = nodeArgs; }
const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', env });
process.exit(r.status == null ? 1 : r.status);
