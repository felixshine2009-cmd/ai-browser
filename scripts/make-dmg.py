#!/usr/bin/env python3
"""Build a drag-to-Applications .dmg on Linux (no hdiutil).

The image is an ISO-9660 + Rock Ridge + Joliet volume (pycdlib) stored with a .dmg extension - macOS' DiskImages
framework sniffs the content, so Finder mounts it like any other disk image. Rock Ridge keeps the unix modes and the
symlinks inside the .app (Electron frameworks need them) and provides the "Applications" shortcut. A .DS_Store
(from electron-builder's vendored ds_store) lays the icons out Finder-style on a dark background.

usage: make-dmg.py <App.app> <out.dmg> [--volname "AI Browser"] [--ds-vendor <dir with ds_store/ biplist/ mac_alias/>]
needs: pip install pycdlib   (venv recommended)
"""
import os, sys, stat, argparse, tempfile, shutil
import pycdlib

ap = argparse.ArgumentParser()
ap.add_argument('app'); ap.add_argument('out')
ap.add_argument('--volname', default='AI Browser')
ap.add_argument('--ds-vendor', default='')
a = ap.parse_args()

app_name = os.path.basename(a.app.rstrip('/'))
used = set()

def iso_name(name, is_dir):
    """ISO-9660 level-4-ish name: upper-case [A-Z0-9_], unique per directory (real name comes from Rock Ridge/Joliet)."""
    base, ext = os.path.splitext(name) if not is_dir else (name, '')
    clean = lambda s: ''.join(c if c.isalnum() and c.isascii() else '_' for c in s).upper() or '_'
    return clean(base)[:28] , clean(ext.lstrip('.'))[:3]

def uniq(dirpath, name, is_dir):
    b, e = iso_name(name, is_dir); n = 0
    while True:
        cand = b if n == 0 else b[:24] + '%04d' % n
        full = (dirpath, cand, e)
        if full not in used:
            used.add(full); break
        n += 1
    return (cand + ('.' + e if (e and not is_dir) else '') + ('' if is_dir else ';1'))

def ds_store(path):
    if not a.ds_vendor: return False
    sys.path.insert(0, a.ds_vendor)
    from ds_store import DSStore
    bwsp = {'ShowStatusBar': False, 'ContainerShowSidebar': False, 'PreviewPaneVisibility': False, 'SidebarWidth': 180,
            'ShowTabView': False, 'ShowToolbar': False, 'ShowPathbar': False, 'ShowSidebar': False,
            'WindowBounds': '{{200, 120}, {640, 400}}'}
    icvp = {'viewOptionsVersion': 1, 'backgroundType': 1, 'backgroundColorRed': 0.059, 'backgroundColorGreen': 0.11, 'backgroundColorBlue': 0.094,
            'gridOffsetX': 0.0, 'gridOffsetY': 0.0, 'gridSpacing': 100.0, 'arrangeBy': 'none', 'showIconPreview': True, 'showItemInfo': False,
            'labelOnBottom': True, 'textSize': 13.0, 'iconSize': 128.0, 'scrollPositionX': 0.0, 'scrollPositionY': 0.0}
    with DSStore.open(path, 'w+') as d:
        d['.']['vSrn'] = ('long', 1); d['.']['bwsp'] = bwsp; d['.']['icvp'] = icvp; d['.']['icvl'] = (b'type', b'icnv')
        d[app_name]['Iloc'] = (170, 190); d['Applications']['Iloc'] = (470, 190)
    return True

# Joliet caps names at 64 chars; electron bundles can exceed that, and a truncated name would break the app, so Joliet is only added when every name fits (Rock Ridge always carries the real names).
JOL = all(len(n) <= 64 for _r, _d, fs_ in os.walk(a.app) for n in list(_d) + list(fs_))
print('joliet:', JOL)
iso = pycdlib.PyCdlib()
iso.new(interchange_level=int(os.environ.get('ISO_LEVEL','3')), vol_ident=a.volname[:32], rock_ridge='1.12', joliet=3 if JOL else None)
count = {'f': 0, 'd': 0, 'l': 0, 'bytes': 0}

def walk(src, p_iso, p_jol):
    for name in sorted(os.listdir(src)):
        p = os.path.join(src, name); st = os.lstat(p)
        if stat.S_ISLNK(st.st_mode):
            iso.add_symlink(p_iso + '/' + uniq(p_iso, name, True), name, os.readlink(p), joliet_path=(p_jol + '/' + name[:100] if JOL else None))
            count['l'] += 1
        elif stat.S_ISDIR(st.st_mode):
            d_iso = p_iso + '/' + uniq(p_iso, name, True); d_jol = p_jol + '/' + name[:100]
            iso.add_directory(d_iso, rr_name=name, joliet_path=(d_jol if JOL else None), file_mode=0o040755)
            count['d'] += 1
            walk(p, d_iso, d_jol)
        elif stat.S_ISREG(st.st_mode):
            mode = 0o100755 if st.st_mode & 0o111 else 0o100644
            iso.add_file(p, p_iso + '/' + uniq(p_iso, name, False), rr_name=name, joliet_path=(p_jol + '/' + name[:100] if JOL else None), file_mode=mode)
            count['f'] += 1; count['bytes'] += st.st_size

# volume root: <App>.app , Applications -> /Applications , .DS_Store
app_iso = '/' + uniq('/', app_name, True); app_jol = '/' + app_name[:100]
iso.add_directory(app_iso, rr_name=app_name, joliet_path=(app_jol if JOL else None), file_mode=0o040755)
walk(a.app, app_iso, app_jol)
iso.add_symlink('/' + uniq('/', 'Applications', True), 'Applications', '/Applications', joliet_path=('/Applications' if JOL else None))
tmp = tempfile.mkdtemp(); dsf = os.path.join(tmp, 'DS_Store')
if ds_store(dsf):
    iso.add_file(dsf, '/' + uniq('/', '.DS_Store', False), rr_name='.DS_Store', joliet_path=('/.DS_Store' if JOL else None), file_mode=0o100644)
iso.write(a.out); iso.close(); shutil.rmtree(tmp, ignore_errors=True)
print('wrote %s  files=%d dirs=%d symlinks=%d payload=%.1f MB  image=%.1f MB' % (a.out, count['f'], count['d'], count['l'], count['bytes'] / 1048576, os.path.getsize(a.out) / 1048576))
