'use strict';
// MTP (multi-token prediction) flags for the embedded MLX LM server. Does not run inference.
const fs = require('fs');
const path = require('path');
const v36 = require('./v36');

function readConfig(model) {
  if (!model || /^https?:/i.test(model) || model.includes('/')) {
    // HF repo ids contain a slash but are not local dirs. Only read a real directory.
  }
  const dir = model && fs.existsSync(model) && fs.statSync(model).isDirectory() ? model : (model && fs.existsSync(path.dirname(model)) ? path.dirname(model) : '');
  if (!dir) return null;
  for (const name of ['config.json', 'params.json']) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) continue;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }
  return null;
}

function probe(model) {
  const json = readConfig(model);
  const info = v36.mtpProbeConfig(json || {});
  return Object.assign({ embedded: true, engine: 'mlx-lm', infer: false }, info);
}

function extraArgs(model) { return v36.mtpExtraArgs(probe(model)); }

module.exports = { probe, extraArgs, readConfig };
