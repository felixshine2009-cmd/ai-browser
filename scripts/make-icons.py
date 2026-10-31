#!/usr/bin/env python3
"""Generate macOS .icns, Windows .ico and tray PNGs from a 1024×1024 (or larger) source image.
Usage: make-icons.py [source.png|jpg]  # defaults to build/icon-source.png
Writes: build/icon-1024.png, icon-{16,32,64,128,256,512}.png, icon.png (256), icon.icns, icon.ico
"""
import os, sys, struct, io
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
BUILD = os.path.join(ROOT, 'build')
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BUILD, 'icon-source.png')
os.makedirs(BUILD, exist_ok=True)
im = Image.open(src).convert('RGBA')
w, h = im.size
s = min(w, h)
im = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))
im1024 = im.resize((1024, 1024), Image.LANCZOS)
im1024.save(os.path.join(BUILD, 'icon-1024.png'))
if os.path.abspath(src) != os.path.abspath(os.path.join(BUILD, 'icon-source.png')):
    im1024.save(os.path.join(BUILD, 'icon-source.png'))
for sz in (16, 32, 64, 128, 256, 512):
    im.resize((sz, sz), Image.LANCZOS).save(os.path.join(BUILD, f'icon-{sz}.png'))
im.resize((256, 256), Image.LANCZOS).save(os.path.join(BUILD, 'icon.png'))

def write_ico(path, sizes=(16, 32, 48, 64, 128, 256)):
    images = [im.resize((s, s), Image.LANCZOS) for s in sizes]
    entries, data, offset = [], b'', 6 + 16 * len(images)
    for img in images:
        buf = io.BytesIO(); img.save(buf, format='PNG'); blob = buf.getvalue()
        w, h = img.size
        entries.append((w if w < 256 else 0, h if h < 256 else 0, len(blob), offset))
        offset += len(blob); data += blob
    out = struct.pack('<HHH', 0, 1, len(images))
    for w, h, size, off in entries:
        out += struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, size, off)
    open(path, 'wb').write(out + data)

write_ico(os.path.join(BUILD, 'icon.ico'))
TYPES = [('icp4', 16), ('icp5', 32), ('icp6', 64), ('ic07', 128), ('ic08', 256), ('ic09', 512), ('ic10', 1024)]
chunks = []
for tag, sz in TYPES:
    buf = io.BytesIO(); im.resize((sz, sz), Image.LANCZOS).save(buf, format='PNG')
    blob = buf.getvalue()
    chunks.append(tag.encode() + struct.pack('>I', 8 + len(blob)) + blob)
body = b''.join(chunks)
open(os.path.join(BUILD, 'icon.icns'), 'wb').write(b'icns' + struct.pack('>I', 8 + len(body)) + body)
print('wrote icons into', BUILD)
