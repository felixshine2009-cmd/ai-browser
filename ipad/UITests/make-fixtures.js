'use strict';
// Fixture files for the iOS Simulator import tests (ipad/UITests). Usage: node ipad/UITests/make-fixtures.js <outDir>
//   files/       one file per import entry (dictionary .mdx + resources, ZIM, disk image, model, text, extension zip, CSV, photo)
//   dictfolder/  a folder with a dictionary in a subfolder (folder import)
//   realdict/    a single dictionary picked in the real Files picker
const fs = require('fs'), path = require('path');
const AdmZip = require('adm-zip');
const ROOT = path.join(__dirname, '..', '..');
const FX = path.join(ROOT, 'test', 'fixtures');
const out = path.resolve(process.argv[2] || 'uitest-fixtures');
fs.rmSync(out, { recursive: true, force: true });
const files = path.join(out, 'files'); fs.mkdirSync(files, { recursive: true });
const dict = path.join(FX, 'dict');
for (const n of ['test.mdx', 'test.mdd']) fs.copyFileSync(path.join(dict, n), path.join(files, n));
for (const n of fs.readdirSync(path.join(dict, 'res'))) fs.copyFileSync(path.join(dict, 'res', n), path.join(files, n));
fs.copyFileSync(path.join(dict, 'res', 'logo.png'), path.join(files, 'photo.png'));
// minimal ZIM (v6): header, MIME list, no entries
const zim = Buffer.alloc(128);
zim.writeUInt32LE(72173914, 0); zim.writeUInt16LE(6, 4); zim.writeUInt16LE(1, 6);
const mimePos = 80, mime = Buffer.from('text/html\0\0', 'latin1'); mime.copy(zim, mimePos);
const end = mimePos + mime.length;
zim.writeBigUInt64LE(BigInt(end), 32); zim.writeBigUInt64LE(BigInt(end), 40); zim.writeBigUInt64LE(BigInt(end), 48); zim.writeBigUInt64LE(BigInt(mimePos), 56);
zim.writeUInt32LE(0xffffffff, 64); zim.writeUInt32LE(0xffffffff, 68); zim.writeBigUInt64LE(BigInt(end), 72);
fs.writeFileSync(path.join(files, 'small.zim'), zim);
// disk image with a boot sector that prints AIB-BOOT-OK
const code = [0x31, 0xDB, 0xBE, 0x13, 0x7C, 0xB4, 0x0E, 0xAC, 0x84, 0xC0, 0x74, 0x04, 0xCD, 0x10, 0xEB, 0xF7, 0xF4, 0xEB, 0xFD];
const img = Buffer.alloc(1024 * 1024); Buffer.from(code).copy(img, 0); Buffer.from('AIB-BOOT-OK\0', 'latin1').copy(img, code.length); img[510] = 0x55; img[511] = 0xaa;
fs.writeFileSync(path.join(files, 'disk.img'), img);
fs.writeFileSync(path.join(files, 'model.gguf'), Buffer.concat([Buffer.from('GGUF'), Buffer.alloc(60)]));
fs.writeFileSync(path.join(files, 'notes.txt'), '导入测试：牛顿第二定律 F = ma。\nImport test: Newton\'s second law.\n');
fs.writeFileSync(path.join(files, 'passwords.csv'), 'name,url,username,password\nexample,https://example.com,felix,uitest-secret\n');
const z = new AdmZip();
const ext = path.join(FX, 'feature-ext-sample');
for (const n of fs.readdirSync(ext)) z.addLocalFile(path.join(ext, n));
z.writeZip(path.join(files, 'extension.zip'));
// folder import: several levels, resources next to the .mdx
const sub = path.join(out, 'dictfolder', '测试词典包', 'OALD');
fs.mkdirSync(sub, { recursive: true });
for (const n of ['test.mdx', 'test.mdd']) fs.copyFileSync(path.join(dict, n), path.join(sub, n));
for (const n of fs.readdirSync(path.join(dict, 'res'))) fs.copyFileSync(path.join(dict, 'res', n), path.join(sub, n));
const real = path.join(out, 'realdict'); fs.mkdirSync(real, { recursive: true });
fs.copyFileSync(path.join(dict, 'test.mdx'), path.join(real, 'oald-test.mdx'));
console.log('fixtures:', out);
