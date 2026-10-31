'use strict';
const fs = require('fs');
const path = require('path');
const results = [];
let currentGroup = '';
const withTimeout = (p, ms, name) => { let t; return Promise.race([p, new Promise((_, r) => { t = setTimeout(() => r(new Error(`timeout ${ms}ms: ${name}`)), ms); })]).finally(() => clearTimeout(t)); };

async function test(name, fn, opts = {}) {
  const t0 = Date.now();
  let status = 'PASS', error = '';
  try { await withTimeout(Promise.resolve().then(fn), opts.timeout || 60000, name); }
  catch (e) { status = 'FAIL'; error = String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e); }
  const r = { group: currentGroup, name, status, ms: Date.now() - t0, error };
  results.push(r);
  console.log(`${status === 'PASS' ? '  ✔' : '  ✘'} [${currentGroup}] ${name} (${r.ms}ms)${error ? '\n      ' + error.slice(0, 600) : ''}`);
  return status === 'PASS';
}
function group(name) { currentGroup = name; console.log('\n== ' + name); }
function skip(name, reason) { results.push({ group: currentGroup, name, status: 'SKIP', ms: 0, error: reason }); console.log(`  - [${currentGroup}] ${name} SKIPPED: ${reason}`); }
function assert(c, msg) { if (!c) throw new Error('assertion failed: ' + (msg || '')); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); }
async function until(fn, ms = 15000, msg = 'condition', step = 150) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await new Promise(r => setTimeout(r, step)); }
  throw new Error(`timeout waiting for ${msg}${last ? ': ' + last.message : ''}`);
}
function report() {
  const pass = results.filter(r => r.status === 'PASS').length, fail = results.filter(r => r.status === 'FAIL').length, skipped = results.filter(r => r.status === 'SKIP').length;
  let md = `# 测试结果\n\n运行时间: ${new Date().toISOString()}\n\n通过 ${pass} / 失败 ${fail} / 跳过 ${skipped} / 共 ${results.length}\n\n| 分组 | 测试项 | 结果 | 耗时 |\n|---|---|---|---|\n`;
  for (const r of results) md += `| ${r.group} | ${r.name.replace(/\|/g, '/')} | ${r.status}${r.error && r.status !== 'PASS' ? ' — ' + r.error.slice(0, 120).replace(/\|/g, '/') : ''} | ${r.ms}ms |\n`;
  fs.writeFileSync(path.join(__dirname, '..', 'RESULTS.md'), md);
  fs.writeFileSync(path.join(__dirname, '..', 'results.json'), JSON.stringify(results, null, 1));
  console.log(`\nSUMMARY: ${pass} passed, ${fail} failed, ${skipped} skipped, ${results.length} total`);
  return fail;
}
module.exports = { test, group, skip, assert, eq, until, report, results };
