'use strict';
// The desktop pattern (main.js): safe-log console + guarded uncaught handler, with a log file sink.
const SL = require('../../../src/main/safe-log.js');
const log = SL.rotatingLog(process.argv[2], { maxBytes: 64 * 1024, keep: 2 });
SL.wrapConsole({ sink: (lvl, a) => log(lvl + ' ' + a.join(' ') + '\n') });
let uncaught = 0;
process.on('uncaughtException', SL.guardedHandler((e) => { uncaught++; console.error('uncaught', e && e.message); }));
console.log('ready');
setTimeout(() => { require('fs').writeFileSync(process.argv[2] + '.uncaught', String(uncaught)); process.exit(0); }, 3200);
