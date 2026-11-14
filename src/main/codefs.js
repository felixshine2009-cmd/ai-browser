'use strict';
// File manager behind the code editor (F5). Three roots: the user's own code folder, the Python working
// directories (shared with the AI's Python tool) and the Linux VM shared folder. Every path is resolved inside its
// root; ".." and absolute paths are refused.
const fs = require('fs');
const path = require('path');

let electronApp = null; try { electronApp = require('electron').app; } catch {}
const userData = () => process.env.AIB_USER_DATA || (electronApp ? electronApp.getPath('userData') : require('os').tmpdir());
const MAX_READ = 4 * 1024 * 1024;

function roots() {
  const out = [{ id: 'code', name: '我的代码', dir: path.join(userData(), 'code') }];
  try { out.push({ id: 'python', name: 'Python 工作目录', dir: require('./python').dirs().work }); } catch {}
  try { out.push({ id: 'share', name: '虚拟机共享目录', dir: require('./vm').dirs().share }); } catch {}
  return out;
}
function resolve(rootId, rel) {
  const r = roots().find(x => x.id === rootId);
  if (!r) throw new Error('未知目录：' + rootId);
  fs.mkdirSync(r.dir, { recursive: true });
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(r.dir, clean);
  if (abs !== r.dir && !abs.startsWith(r.dir + path.sep)) throw new Error('路径超出允许的目录范围');
  return { root: r, abs, rel: path.relative(r.dir, abs).split(path.sep).join('/') };
}
function list(rootId, rel) {
  const { abs, rel: r } = resolve(rootId, rel);
  const ents = fs.readdirSync(abs, { withFileTypes: true }).filter(e => !e.name.startsWith('.'));
  const items = ents.map(e => { let st = null; try { st = fs.statSync(path.join(abs, e.name)); } catch {} return { name: e.name, dir: e.isDirectory(), size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 }; });
  items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return { root: rootId, path: r, items };
}
function read(rootId, rel) {
  const { abs, rel: r } = resolve(rootId, rel);
  const st = fs.statSync(abs);
  if (st.isDirectory()) throw new Error('这是一个文件夹');
  if (st.size > MAX_READ) throw new Error('文件过大（超过 4 MB），无法在编辑器中打开');
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) throw new Error('这是二进制文件，无法以文本方式编辑');
  return { root: rootId, path: r, text: buf.toString('utf8'), mtime: st.mtimeMs };
}
function write(rootId, rel, text) {
  const { abs, rel: r } = resolve(rootId, rel);
  if (!r) throw new Error('请提供文件名');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, String(text ?? ''));
  return { root: rootId, path: r, mtime: fs.statSync(abs).mtimeMs };
}
function mkdir(rootId, rel) { const { abs, rel: r } = resolve(rootId, rel); if (!r) throw new Error('请提供文件夹名'); fs.mkdirSync(abs, { recursive: true }); return { root: rootId, path: r }; }
function remove(rootId, rel) { const { abs, rel: r } = resolve(rootId, rel); if (!r) throw new Error('不能删除根目录'); fs.rmSync(abs, { recursive: true, force: true }); return true; }
function rename(rootId, from, to) {
  const a = resolve(rootId, from), b = resolve(rootId, to);
  if (!a.rel || !b.rel) throw new Error('不能重命名根目录');
  if (fs.existsSync(b.abs)) throw new Error('目标名称已存在');
  fs.mkdirSync(path.dirname(b.abs), { recursive: true }); fs.renameSync(a.abs, b.abs); return { root: rootId, path: b.rel };
}
/** run a file: Python through the embedded interpreter, shell scripts in the Linux VM (shared folder only) */
async function run(rootId, rel, text) {
  const { root, abs, rel: r } = resolve(rootId, rel);
  const code = text != null ? String(text) : fs.readFileSync(abs, 'utf8');
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.py') {
    // inside the Python work dir the session is the first path segment, so neighbouring files are visible to the code
    const session = rootId === 'python' && r.includes('/') ? r.split('/')[0] : 'code-editor';
    const res = await require('./python').run({ code, session, timeoutMs: 120000 });
    return Object.assign({ kind: 'python' }, res, { images: (res.images || []).map(i => ({ name: i.name, dataUrl: i.dataUrl })) });
  }
  if (ext === '.sh' && rootId === 'share') {
    const res = await require('./vm').shell(`cd /mnt/share && sh ${JSON.stringify(r)}`, { timeoutSec: 120 });
    return Object.assign({ kind: 'shell' }, res);
  }
  if (ext === '.html' || ext === '.htm') return { kind: 'open', url: require('url').pathToFileURL(abs).href };
  throw new Error(ext === '.sh' ? 'Shell 脚本请放在“虚拟机共享目录”中运行' : '暂不支持运行此类文件（支持 .py、.sh 与 .html）');
}
module.exports = { roots: () => roots().map(r => ({ id: r.id, name: r.name })), list, read, write, mkdir, remove, rename, run, resolve };
