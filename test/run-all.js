'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./lib/runner');
(async () => {
  const filter = process.argv[2];
  const files = fs.readdirSync(path.join(__dirname, 'suites')).filter(f => f.endsWith('.js')).sort().filter(f => !filter || f.includes(filter));
  for (const f of files) {
    try { await require('./suites/' + f)(R); } catch (e) { R.results.push({ group: f, name: 'suite crashed', status: 'FAIL', ms: 0, error: String(e.stack || e) }); console.log('SUITE CRASH', f, e); }
  }
  const failed = R.report();
  process.exit(failed ? 1 : 0);
})();
