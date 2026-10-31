#!/usr/bin/env python3
"""Zip a directory preserving symlinks and unix modes (needed for macOS .app bundles).
usage: zipdir.py <dir> <out.zip> [--keep-parent]"""
import os, stat, sys, zipfile
src, out = os.path.abspath(sys.argv[1]), sys.argv[2]
base = os.path.dirname(src) if '--keep-parent' in sys.argv else src
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for root, dirs, files in os.walk(src):
        for name in sorted(dirs + files):
            p = os.path.join(root, name)
            rel = os.path.relpath(p, base)
            st = os.lstat(p)
            zi = zipfile.ZipInfo(rel + ('/' if stat.S_ISDIR(st.st_mode) else ''))
            zi.create_system = 3
            zi.date_time = (2026, 1, 1, 0, 0, 0)
            zi.external_attr = (st.st_mode & 0xFFFF) << 16
            if stat.S_ISLNK(st.st_mode):
                z.writestr(zi, os.readlink(p))
            elif stat.S_ISDIR(st.st_mode):
                zi.external_attr |= 0x10
                z.writestr(zi, b'')
            else:
                zi.compress_type = zipfile.ZIP_DEFLATED
                with open(p, 'rb') as f:
                    z.writestr(zi, f.read())
