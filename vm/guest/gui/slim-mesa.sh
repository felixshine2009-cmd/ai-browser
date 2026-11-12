#!/usr/bin/env bash
# Xvfb and Xfe link libGL, which pulls in Mesa (libgallium + LLVM, ~80 MB compressed) although nothing in the light iPad
# desktop renders with OpenGL (Xvfb runs with -extension GLX). Replace libGL with a stub that exports the same function
# names (each returns 0) and drop Mesa. Usage: slim-mesa.sh <rootfs> <workdir>   (i686 rootfs, binutils on the host)
set -euo pipefail
R="$1"; W="$2"
GL=$(readlink -f "$R/usr/lib/libGL.so.1")
nm -D --defined-only "$GL" | awk '$2=="T"{print $3}' | sort -u > "$W/gl-syms.txt"
{ echo '.text'; echo '.globl aib_gl_stub'; echo '.type aib_gl_stub,@function'; echo 'aib_gl_stub: xorl %eax,%eax'; echo ' ret';
  while read -r s; do echo ".globl $s"; echo ".type $s,@function"; echo ".set $s, aib_gl_stub"; done < "$W/gl-syms.txt"; } > "$W/glstub.s"
as --32 -o "$W/glstub.o" "$W/glstub.s"
ld -m elf_i386 -shared -soname libGL.so.1 -o "$W/libGL-stub.so" "$W/glstub.o"
sudo rm -f "$R"/usr/lib/libGL.so.1* "$R"/usr/lib/libgallium-*.so "$R"/usr/lib/libLLVM* "$R"/usr/lib/libEGL.so* "$R"/usr/lib/libgbm.so* \
  "$R"/usr/lib/libSPIRV-Tools*.so* "$R"/usr/bin/spirv-* "$R"/usr/lib/libglapi.so* "$R"/usr/lib/libGLESv2.so* "$R"/usr/lib/libGLESv1_CM.so*
sudo rm -rf "$R"/usr/lib/gallium-pipe "$R"/usr/lib/dri "$R"/usr/lib/xorg/modules/dri "$R"/usr/share/drirc.d
sudo cp "$W/libGL-stub.so" "$R/usr/lib/libGL.so.1"; sudo ln -sf libGL.so.1 "$R/usr/lib/libGL.so"
# every remaining ELF must still resolve its NEEDED libraries
python3 - "$R" <<'PY'
import os, subprocess, sys
R = sys.argv[1]; have = set()
for d in ('lib', 'usr/lib'):
    for f in os.listdir(os.path.join(R, d)): have.add(f)
bad = []
for d in ('bin', 'sbin', 'usr/bin', 'usr/sbin', 'usr/lib', 'lib'):
    p = os.path.join(R, d)
    for f in os.listdir(p):
        fp = os.path.join(p, f)
        if os.path.islink(fp) or not os.path.isfile(fp): continue
        with open(fp, 'rb') as fh:
            if fh.read(4) != b'\x7fELF': continue
        out = subprocess.run(['readelf', '-d', fp], capture_output=True, text=True).stdout
        for l in out.splitlines():
            if '(NEEDED)' in l:
                lib = l.split('[')[1].rstrip(']')
                if lib not in have: bad.append((fp[len(R):], lib))
if bad:
    print('unresolved after slimming:', bad[:20]); sys.exit(1)
print('libGL stub ok')
PY
