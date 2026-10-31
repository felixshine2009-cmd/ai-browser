#!/usr/bin/env python3
"""Build a drag-to-Applications .dmg for AI Browser.app.
Prefers a real HFS+ → UDIF image via libdmg-hfsplus (hfsplus + dmg).
Falls back to an ISO-9660 + Rock Ridge volume with a .dmg extension (pycdlib).
Usage: make-dmg.py <App.app> <out.dmg> [--volname NAME] [--ds-vendor DIR] [--hfs-tools DIR]
"""
import argparse, os, shutil, stat, subprocess, sys, tempfile

a = argparse.ArgumentParser()
a.add_argument('app'); a.add_argument('out')
a.add_argument('--volname', default='AI Browser')
a.add_argument('--ds-vendor', default='')
a.add_argument('--hfs-tools', default='', help='dir containing hfsplus and dmg binaries (libdmg-hfsplus build)')
a = a.parse_args()
a.app = os.path.abspath(a.app); a.out = os.path.abspath(a.out)
if not os.path.isdir(a.app) or not a.app.endswith('.app'):
    sys.exit('need a .app bundle directory')

app_name = os.path.basename(a.app.rstrip('/'))

def find_tools():
    cands = [a.hfs_tools,
             os.environ.get('AIB_HFS_TOOLS', ''),
             '/workspace/libdmg-hfsplus/build',
             os.path.join(os.path.dirname(__file__), 'vendor', 'libdmg')]
    for root in cands:
        if not root: continue
        h = os.path.join(root, 'hfs', 'hfsplus') if os.path.isdir(os.path.join(root, 'hfs')) else os.path.join(root, 'hfsplus')
        d = os.path.join(root, 'dmg', 'dmg') if os.path.isdir(os.path.join(root, 'dmg')) else os.path.join(root, 'dmg')
        # also check flat
        if not os.path.isfile(h): h = os.path.join(root, 'hfsplus')
        if not os.path.isfile(d): d = os.path.join(root, 'dmg')
        empty = os.path.join(root, 'empty.hfs')
        if not os.path.isfile(empty):
            empty = '/workspace/libdmg-hfsplus/test/empty.hfs'
        if os.path.isfile(h) and os.path.isfile(d) and os.path.isfile(empty):
            return h, d, empty
    return None

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

def dir_size(p):
    t = 0
    for r, ds, fs in os.walk(p):
        for f in fs:
            fp = os.path.join(r, f)
            try: t += os.lstat(fp).st_size
            except: pass
    return t

def build_hfs(tools):
    hfsplus, dmgbin, empty = tools
    stage = tempfile.mkdtemp(prefix='aib-dmg-')
    try:
        staged_app = os.path.join(stage, app_name)
        shutil.copytree(a.app, staged_app, symlinks=True)
        os.symlink('/Applications', os.path.join(stage, 'Applications'))
        dsf = os.path.join(stage, '.DS_Store')
        if ds_store(dsf): pass
        else:
            try: os.remove(dsf)
            except: pass
        hfs = os.path.join(stage, 'vol.hfs')
        shutil.copyfile(empty, hfs)
        need = dir_size(stage) + 64 * 1048576  # headroom for HFS structures
        need = max(need, 64 * 1048576)
        # grow expects absolute byte size of the volume image
        subprocess.check_call([hfsplus, hfs, 'grow', str(need)])
        subprocess.check_call([hfsplus, '--symlinks=clone_link', hfs, 'addall', stage])
        # remove the temporary hfs/DS_Store from being re-added weirdly — addall added vol.hfs into itself? exclude by staging only app+apps+ds
        # Actually addall of `stage` includes vol.hfs — BAD. Re-do with a content-only dir.
        raise RuntimeError('rebuild with content-only stage')
    finally:
        shutil.rmtree(stage, ignore_errors=True)

def build_hfs_clean(tools):
    hfsplus, dmgbin, empty = tools
    root = tempfile.mkdtemp(prefix='aib-dmg-')
    content = os.path.join(root, 'content')
    os.makedirs(content)
    try:
        shutil.copytree(a.app, os.path.join(content, app_name), symlinks=True)
        os.symlink('/Applications', os.path.join(content, 'Applications'))
        dsf = os.path.join(content, '.DS_Store')
        if not ds_store(dsf):
            try: os.remove(dsf)
            except: pass
        hfs = os.path.join(root, 'vol.hfs')
        shutil.copyfile(empty, hfs)
        need = dir_size(content) + 80 * 1048576
        need = max(need, 128 * 1048576)
        print('hfs grow to %.1f MB' % (need / 1048576))
        subprocess.check_call([hfsplus, hfs, 'grow', str(int(need))])
        subprocess.check_call([hfsplus, '--symlinks=clone_link', hfs, 'addall', content])
        print('hfs contents:'); subprocess.call([hfsplus, hfs, 'ls'])
        os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
        if os.path.exists(a.out): os.remove(a.out)
        subprocess.check_call([dmgbin, '-c', 'zlib', 'build', hfs, a.out])
        print('wrote UDIF/HFS+ %s  image=%.1f MB  payload=%.1f MB' % (a.out, os.path.getsize(a.out) / 1048576, dir_size(content) / 1048576))
        return True
    finally:
        shutil.rmtree(root, ignore_errors=True)

# ---------- ISO fallback (pycdlib) ----------
def build_iso():
    import pycdlib
    used = set()
    def iso_name(name, is_dir):
        base, ext = os.path.splitext(name) if not is_dir else (name, '')
        clean = lambda s: ''.join(c if c.isalnum() and c.isascii() else '_' for c in s).upper() or '_'
        return clean(base)[:28], clean(ext.lstrip('.'))[:3]
    def uniq(dirpath, name, is_dir):
        b, e = iso_name(name, is_dir); n = 0
        while True:
            cand = b if n == 0 else b[:24] + '%04d' % n
            full = (dirpath, cand, e)
            if full not in used:
                used.add(full); break
            n += 1
        return (cand + ('.' + e if (e and not is_dir) else '') + ('' if is_dir else ';1'))
    # Joliet only when every filename ≤ 64 chars (Electron bundles usually are not)
    JOL = all(len(n) <= 64 for _r, _d, fs_ in os.walk(a.app) for n in list(_d) + list(fs_))
    print('iso fallback; joliet:', JOL)
    iso = pycdlib.PyCdlib()
    iso.new(interchange_level=int(os.environ.get('ISO_LEVEL', '3')), vol_ident=a.volname[:32], rock_ridge='1.12', joliet=3 if JOL else None)
    count = {'f': 0, 'd': 0, 'l': 0, 'bytes': 0}
    def walk(src, p_iso, p_jol):
        for name in sorted(os.listdir(src)):
            p = os.path.join(src, name); st = os.lstat(p)
            if stat.S_ISLNK(st.st_mode):
                iso.add_symlink(p_iso + '/' + uniq(p_iso, name, True), name, os.readlink(p), joliet_path=(p_jol + '/' + name[:100] if JOL else None)); count['l'] += 1
            elif stat.S_ISDIR(st.st_mode):
                d_iso = p_iso + '/' + uniq(p_iso, name, True); d_jol = p_jol + '/' + name[:100]
                iso.add_directory(d_iso, rr_name=name, joliet_path=(d_jol if JOL else None), file_mode=0o040755); count['d'] += 1
                walk(p, d_iso, d_jol)
            elif stat.S_ISREG(st.st_mode):
                mode = 0o100755 if st.st_mode & 0o111 else 0o100644
                iso.add_file(p, p_iso + '/' + uniq(p_iso, name, False), rr_name=name, joliet_path=(p_jol + '/' + name[:100] if JOL else None), file_mode=mode)
                count['f'] += 1; count['bytes'] += st.st_size
    app_iso = '/' + uniq('/', app_name, True); app_jol = '/' + app_name[:100]
    iso.add_directory(app_iso, rr_name=app_name, joliet_path=(app_jol if JOL else None), file_mode=0o040755)
    walk(a.app, app_iso, app_jol)
    iso.add_symlink('/' + uniq('/', 'Applications', True), 'Applications', '/Applications', joliet_path=('/Applications' if JOL else None))
    tmp = tempfile.mkdtemp(); dsf = os.path.join(tmp, 'DS_Store')
    if ds_store(dsf):
        iso.add_file(dsf, '/' + uniq('/', '.DS_Store', False), rr_name='.DS_Store', joliet_path=('/.DS_Store' if JOL else None), file_mode=0o100644)
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    if os.path.exists(a.out): os.remove(a.out)
    iso.write(a.out); iso.close(); shutil.rmtree(tmp, ignore_errors=True)
    print('wrote ISO-in-dmg %s  files=%d dirs=%d symlinks=%d payload=%.1f MB  image=%.1f MB (may contain rr_moved for deep trees)' % (
        a.out, count['f'], count['d'], count['l'], count['bytes'] / 1048576, os.path.getsize(a.out) / 1048576))

tools = find_tools()
if tools:
    try:
        build_hfs_clean(tools); sys.exit(0)
    except Exception as e:
        print('HFS+/UDIF build failed (%s); falling back to ISO' % e, file=sys.stderr)
build_iso()
