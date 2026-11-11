#!/usr/bin/env python3
"""Stage the embedded Python + VM helper into the macOS arm64 app (called by scripts/stage.js).
  python/  ← python-build-standalone CPython 3.12 (aarch64-apple-darwin, install_only_stripped)
             + numpy, scipy, sympy, mpmath, pandas, matplotlib (macOS arm64 wheels unpacked into site-packages)
  vm/vfkit ← vfkit (Apache-2.0) arm64 slice, for Apple Virtualization.framework
Downloads are cached in vendor-cache/ (gitignored). usage: stage-runtime.py <stage_app_dir>"""
import os, sys, struct, shutil, subprocess, tarfile, zipfile, urllib.request, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'vendor-cache')
PBS = 'https://github.com/astral-sh/python-build-standalone/releases/download/20261110/cpython-3.12.16%2B20261110-aarch64-apple-darwin-install_only_stripped.tar.gz'
VFKIT = 'https://github.com/crc-org/vfkit/releases/download/v0.6.4/vfkit'
LIBS = ['numpy', 'scipy', 'sympy', 'mpmath', 'pandas', 'matplotlib']
PYVER = '3.12'


def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        print('download', url)
        tmp = p + '.part'
        with urllib.request.urlopen(url) as r, open(tmp, 'wb') as f:
            shutil.copyfileobj(r, f)
        os.rename(tmp, p)
    return p


def thin_arm64(src, dst):
    d = open(src, 'rb').read()
    magic = struct.unpack('>I', d[:4])[0]
    if magic not in (0xcafebabe, 0xcafebabf):
        shutil.copyfile(src, dst); return
    n = struct.unpack('>I', d[4:8])[0]
    for i in range(n):
        if magic == 0xcafebabe:
            cpu, sub, off, size, align = struct.unpack('>IIIII', d[8 + i * 20: 28 + i * 20])
        else:
            cpu, sub, off, size, align, _ = struct.unpack('>IIQQII', d[8 + i * 32: 40 + i * 32])
        if cpu == 0x0100000C:  # CPU_TYPE_ARM64
            open(dst, 'wb').write(d[off:off + size]); return
    raise SystemExit('no arm64 slice in vfkit')


def main(stage):
    # ---- CPython
    tgz = fetch(PBS, 'cpython-3.12-aarch64-apple-darwin.tar.gz')
    pydir = os.path.join(stage, 'python')
    shutil.rmtree(pydir, ignore_errors=True)
    with tarfile.open(tgz) as t:
        t.extractall(stage, filter='tar')  # archive root is python/
    lib = os.path.join(pydir, 'lib', 'python' + PYVER)
    for junk in ['test', 'idlelib', 'turtledemo', 'tkinter', 'ensurepip', 'lib2to3', 'pydoc_data']:
        shutil.rmtree(os.path.join(lib, junk), ignore_errors=True)
    for d in os.listdir(os.path.join(pydir, 'lib')):
        if d.startswith(('tcl', 'tk', 'itcl', 'thread')) and os.path.isdir(os.path.join(pydir, 'lib', d)):
            shutil.rmtree(os.path.join(pydir, 'lib', d), ignore_errors=True)
    # ---- scientific wheels (macOS arm64, macOS 12+)
    wh = os.path.join(CACHE, 'wheels-macos-arm64')
    os.makedirs(wh, exist_ok=True)
    subprocess.check_call([sys.executable, '-m', 'pip', 'download', '-q', '--dest', wh, '--platform', 'macosx_11_0_arm64', '--platform', 'macosx_12_0_arm64',
                           '--only-binary=:all:', '--python-version', PYVER, '--implementation', 'cp', *LIBS])
    site = os.path.join(lib, 'site-packages')
    for f in sorted(os.listdir(wh)):
        if f.endswith('.whl'):
            with zipfile.ZipFile(os.path.join(wh, f)) as z:
                z.extractall(site)
    for d, dirs, files in os.walk(site):
        for x in list(dirs):
            if x in ('tests', 'test') and ('numpy' in d or 'scipy' in d or 'pandas' in d or 'matplotlib' in d):
                shutil.rmtree(os.path.join(d, x), ignore_errors=True); dirs.remove(x)
        for f in files:  # wheels unpacked by zipfile lose the exec bit: restore it on Mach-O / scripts
            p = os.path.join(d, f)
            if f.endswith(('.so', '.dylib')):
                os.chmod(p, 0o755)
    open(os.path.join(pydir, 'AIB_BUNDLED.txt'), 'w').write('python-build-standalone 20261110, CPython 3.12.16, + ' + ', '.join(LIBS) + '\n')
    # ---- vfkit (arm64 slice of the signed universal binary)
    vf = fetch(VFKIT, 'vfkit-0.6.4-universal')
    os.makedirs(os.path.join(stage, 'vm'), exist_ok=True)
    thin_arm64(vf, os.path.join(stage, 'vm', 'vfkit'))
    os.chmod(os.path.join(stage, 'vm', 'vfkit'), 0o755)
    total = 0
    for d, _, fs in os.walk(pydir):
        for f in fs:
            p = os.path.join(d, f)
            if not os.path.islink(p):
                total += os.path.getsize(p)
    print('staged python (%d MB) and vm/vfkit (%d MB)' % (total // 2**20, os.path.getsize(os.path.join(stage, 'vm', 'vfkit')) // 2**20))


if __name__ == '__main__':
    main(sys.argv[1])
