'use strict';
const v36 = require('./v36');

async function check(fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  let chrome = '', electron = '';
  try { const p = process.versions || {}; chrome = p.chrome || ''; electron = p.electron || ''; } catch {}
  let latest = { chrome: '', electron: '', zip: '' };
  try {
    const res = await fetchFn('https://api.github.com/repos/electron/electron/releases/latest', { headers: { 'User-Agent': 'ai-browser', Accept: 'application/vnd.github+json' } });
    if (res.ok) {
      const j = await res.json();
      latest.electron = String(j.tag_name || '').replace(/^v/, '');
      const blob = JSON.stringify(j);
      const m = blob.match(/Chrome\/([\d.]+)/i) || blob.match(/Chromium ([\d.]+)/i);
      if (m) latest.chrome = m[1];
    }
  } catch (e) { latest.error = String(e.message || e); }
  try {
    const res = await fetchFn('https://api.github.com/repos/felixshine2009-cmd/ai-browser/releases/latest', { headers: { 'User-Agent': 'ai-browser', Accept: 'application/vnd.github+json' } });
    if (res.ok) {
      const j = await res.json();
      const asset = (j.assets || []).find(a => /mac-arm64\.zip$/i.test(a.name));
      if (asset) latest.zip = asset.browser_download_url;
    }
  } catch {}
  const plan = v36.kernelPlan({ chrome, electron }, latest);
  return Object.assign({ current: { chrome, electron }, latest }, plan);
}

module.exports = { check };
