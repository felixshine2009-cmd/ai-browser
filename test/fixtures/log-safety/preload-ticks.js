'use strict';
// Preloaded (node -r) into a process under test: keeps logging every 20 ms and throws one uncaught error after
// 400 ms, so that output keeps flowing after the reader of stdout has gone away.
setTimeout(() => {
  const t = setInterval(() => console.log('tick', Date.now()), 20);
  setTimeout(() => { throw new Error('test uncaught error'); }, 100);
  setTimeout(() => { clearInterval(t); console.log('done'); }, Number(process.env.AIB_TICKS_MS || 2500));
}, 400);
