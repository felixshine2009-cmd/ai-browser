#!/usr/bin/env bash
# Build the AI Browser Linux guest (Alpine) from a Linux x86_64 host without emulation.
#   vm/build-guest.sh aarch64 <out>   → desktop image for Apple Virtualization.framework (vfkit):
#        vmlinux (uncompressed arm64 Image), initramfs.gz, rootfs.img (ext4)  + .gz copies for download
#   vm/build-guest.sh x86 <out>       → iPad / v86 image: bzImage, initramfs.gz, rootfs/ (9p root, v86 fs.json + sha256 files)
# Needs: sudo, curl, mkfs.ext4, cpio, depmod, python3, zstd/gzip.
set -euo pipefail
ARCH="${1:?arch aarch64|x86}"; OUT="$(realpath -m "${2:?out dir}")"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/.." && pwd)"
ALP=v3.22; MIRROR="${ALPINE_MIRROR:-https://dl-cdn.alpinelinux.org/alpine}"
WORK="${WORK:-/tmp/aib-vm-$ARCH}"; RFS="$WORK/rootfs"
sudo rm -rf "$WORK"; mkdir -p "$WORK" "$OUT"
APK="$WORK/apk.static"
curl -fsSL "$MIRROR/$ALP/main/x86_64/apk-tools-static-2.14.13-r0.apk" | tar -xz -C "$WORK" sbin/apk.static 2>/dev/null; mv "$WORK/sbin/apk.static" "$APK"
MINI=$(curl -fsSL "$MIRROR/$ALP/releases/$ARCH/latest-releases.yaml" | sed -n 's/.*file: \(alpine-minirootfs-.*\.tar\.gz\)/\1/p' | head -1)
curl -fsSL -o "$WORK/mini.tgz" "$MIRROR/$ALP/releases/$ARCH/$MINI"
sudo mkdir -p "$RFS"; sudo tar -xzf "$WORK/mini.tgz" -C "$RFS"
echo -e "https://dl-cdn.alpinelinux.org/alpine/$ALP/main\nhttps://dl-cdn.alpinelinux.org/alpine/$ALP/community" | sudo tee "$RFS/etc/apk/repositories" >/dev/null
COMMON="python3 py3-pip py3-numpy py3-scipy py3-sympy py3-mpmath py3-matplotlib py3-pandas py3-pillow linux-virt busybox-static e2fsprogs ca-certificates-bundle curl bash tzdata"
if [ "$ARCH" = aarch64 ]; then PKGS="$COMMON git ripgrep patch build-base python3-dev e2fsprogs-extra openssh-client wget file less"; else PKGS="$COMMON blas cblas lapack git ripgrep patch"; fi
# GUI=1 (x86 only): light graphical image for iPad computer use — Xvfb + JWM + xterm + xdotool (+ Dillo, Xfe)
GUI="${GUI:-0}"
if [ "$GUI" = 1 ]; then PKGS="$PKGS xvfb xdotool xsetroot jwm xterm dillo xfe font-dejavu font-misc-misc xrdb"; fi
sudo "$APK" --arch "$ARCH" --root "$RFS" --keys-dir "$RFS/etc/apk/keys" --no-scripts --no-cache --update-cache add $PKGS
# busybox applet links (package post-install script was skipped)
if [ -f "$RFS/etc/busybox-paths.d/busybox" ]; then
  while read -r p; do [ -n "$p" ] && [ ! -L "$RFS/$p" ] && [ ! -e "$RFS/$p" ] && sudo ln -s /bin/busybox "$RFS/$p" || true; done < "$RFS/etc/busybox-paths.d/busybox"
fi
if [ "$ARCH" = x86 ]; then
  # v86 has no SSSE3: Alpine's OpenBLAS uses palignr in shared kernels (dlaswp) → SIGILL in numpy.linalg.
  # Replace libopenblas.so.3 with a stub that pulls in reference BLAS/CBLAS/LAPACK (same symbols, baseline x86 code).
  ld -m elf_i386 -shared -soname libopenblas.so.3 --no-as-needed -rpath-link "$RFS/usr/lib" \
     "$RFS/usr/lib/libcblas.so.3" "$RFS/usr/lib/liblapack.so.3" "$RFS/usr/lib/libblas.so.3" -o "$WORK/libopenblas-stub.so"
  sudo rm -f "$RFS"/usr/lib/libopenblas.so.3 "$RFS"/usr/lib/libopenblasp-r*.so
  sudo cp "$WORK/libopenblas-stub.so" "$RFS/usr/lib/libopenblas.so.3"
fi
KVER=$(ls "$RFS/lib/modules" | head -1)
# host kmod may lack zlib: store modules uncompressed, then index them
sudo find "$RFS/lib/modules/$KVER" -name '*.ko.gz' -exec gunzip -f {} +
sudo /sbin/depmod -a -b "$RFS" "$KVER"
# guest services
sudo mkdir -p "$RFS/opt/aib" "$RFS/etc/aib" "$RFS/root/work" "$RFS/persist/site" "$RFS/mnt/share"
sudo cp "$HERE/guest/agent.py" "$ROOT/src/main/python/kernel.py" "$RFS/opt/aib/"
sudo cp "$HERE/guest/aib-setup" "$RFS/sbin/aib-setup"; sudo chmod 755 "$RFS/sbin/aib-setup"
if [ "$GUI" = 1 ]; then
  sudo mkdir -p "$RFS/usr/local/sbin" "$RFS/etc"; sudo cp "$HERE/guest/gui/aib-desktop" "$RFS/usr/local/sbin/aib-desktop"; sudo chmod 755 "$RFS/usr/local/sbin/aib-desktop"
  sudo cp "$HERE/guest/gui/system.jwmrc" "$RFS/etc/system.jwmrc"
  # fontconfig cache: built natively (i686 binaries run on the x86_64 build host)
  sudo chroot "$RFS" /usr/bin/fc-cache -f >/dev/null 2>&1 || echo "warning: fc-cache failed"
  # font package triggers were skipped (--no-scripts): index the core X fonts; xterm uses DejaVu Sans Mono via Xft
  for d in "$RFS"/usr/share/fonts/*/; do sudo chroot "$RFS" sh -c "mkfontscale /usr/share/fonts/$(basename "$d") && mkfontdir /usr/share/fonts/$(basename "$d")" 2>/dev/null || true; done
  sudo mkdir -p "$RFS/etc/X11/Xresources"; printf 'XTerm*faceName: DejaVu Sans Mono\nXTerm*faceSize: 11\nXTerm*background: #101418\nXTerm*foreground: #e6e6e6\nXTerm*scrollBar: false\n' | sudo tee "$RFS/etc/X11/Xresources/aib" >/dev/null
  bash "$HERE/guest/gui/slim-mesa.sh" "$RFS" "$WORK"
fi
if [ "$ARCH" = x86 ]; then AGENT_ARGS="--tty /dev/ttyS0"; else AGENT_ARGS=""; fi
sudo tee "$RFS/etc/inittab" >/dev/null <<IT
::sysinit:/sbin/aib-setup
::respawn:/usr/bin/python3 /opt/aib/agent.py $AGENT_ARGS
::ctrlaltdel:/sbin/reboot
::shutdown:/bin/sync
::shutdown:/bin/umount -a -r
IT
echo "af_packet virtio_net vmw_vsock_virtio_transport virtio_console virtiofs fuse 9pnet_virtio 9p" | sudo tee "$RFS/etc/aib/modules" >/dev/null
echo aib-vm | sudo tee "$RFS/etc/hostname" >/dev/null
echo "nameserver 1.1.1.1" | sudo tee "$RFS/etc/resolv.conf" >/dev/null
sudo mkdir -p "$RFS/etc/pip"; printf '[global]\nbreak-system-packages = true\nroot-user-action = ignore\ndisable-pip-version-check = true\n' | sudo tee "$RFS/etc/pip.conf" >/dev/null
sudo sed -i 's#^root:[^:]*:#root::#' "$RFS/etc/shadow" 2>/dev/null || true
# matplotlib font cache + pyc are built on first use; drop docs/tests to save space
sudo rm -rf "$RFS"/usr/share/doc "$RFS"/usr/share/man "$RFS"/usr/lib/python3*/site-packages/*/tests "$RFS"/usr/lib/python3*/site-packages/scipy/*/tests "$RFS"/var/cache/apk/*
# ---- keep only the kernel modules the guest actually loads (saves ~100 MB)
if [ "$ARCH" = x86 ]; then WANT="virtio_pci 9pnet_virtio 9p"; else WANT="virtio_pci virtio_blk crc32c_generic libcrc32c ext4 virtio_mmio"; fi
KEEP="$WANT $(cat "$RFS/etc/aib/modules")"
python3 "$HERE/moddeps.py" "$RFS/lib/modules/$KVER" $KEEP > "$WORK/keep.txt" 2>/dev/null
sudo python3 - "$RFS/lib/modules/$KVER" "$WORK/keep.txt" <<'PY'
import os, sys
base, keep = sys.argv[1], set(l.strip() for l in open(sys.argv[2]) if l.strip())
for d, _, fs in os.walk(base):
    for f in fs:
        rel = os.path.relpath(os.path.join(d, f), base)
        if f.endswith('.ko') and rel not in keep:
            os.remove(os.path.join(d, f))
PY
sudo /sbin/depmod -a -b "$RFS" "$KVER"
# ---- initramfs: busybox-static + the modules needed to reach the root fs
IR="$WORK/initramfs"; mkdir -p "$IR"/{bin,dev,proc,sys,newroot,lib/modules}
cp "$RFS/bin/busybox.static" "$IR/bin/busybox"
python3 "$HERE/moddeps.py" "$RFS/lib/modules/$KVER" $WANT > "$WORK/mods.txt"
: > "$IR/modules.list"
while read -r m; do [ -z "$m" ] && continue; b=$(basename "$m"); b=${b%.gz}; b=${b%.zst}; b=${b%.xz}
  case "$m" in *.gz) gzip -dc "$RFS/lib/modules/$KVER/$m" > "$IR/lib/modules/$b";; *.zst) zstd -qdc "$RFS/lib/modules/$KVER/$m" > "$IR/lib/modules/$b";; *.xz) xz -dc "$RFS/lib/modules/$KVER/$m" > "$IR/lib/modules/$b";; *) cp "$RFS/lib/modules/$KVER/$m" "$IR/lib/modules/$b";; esac
  echo "$b" >> "$IR/modules.list"; done < "$WORK/mods.txt"
cp "$HERE/guest/initramfs-init" "$IR/init"; chmod 755 "$IR/init"
( cd "$IR" && find . | cpio -o -H newc --quiet | gzip -9 > "$OUT/initramfs.gz" )
sudo cp "$RFS/boot/vmlinuz-virt" "$WORK/vmlinuz-virt"; sudo chmod 644 "$WORK/vmlinuz-virt"; sudo rm -rf "$RFS/boot"
if [ "$ARCH" = aarch64 ]; then
  K="$WORK/vmlinuz-virt"
  if gzip -t "$K" 2>/dev/null; then gzip -dc "$K" > "$OUT/vmlinux"; else
    python3 "$HERE/unpack-arm64-image.py" "$K" "$OUT/vmlinux"; fi
  # ext4 root image: content + headroom; the host grows the file and the guest runs resize2fs on boot
  USED=$(sudo du -sm "$RFS" | cut -f1); SIZE=$((USED + 400))
  rm -f "$OUT/rootfs.img"; sudo mkfs.ext4 -q -L aibroot -E root_owner=0:0 -O ^has_journal,^metadata_csum_seed -d "$RFS" "$OUT/rootfs.img" "${SIZE}M"
  sudo chown "$(id -u):$(id -g)" "$OUT/rootfs.img"; sudo tune2fs -O has_journal "$OUT/rootfs.img" >/dev/null
  ( cd "$OUT" && gzip -9 -k -f vmlinux && gzip -6 -k -f rootfs.img )
  ( cd "$OUT" && sha256sum vmlinux.gz initramfs.gz rootfs.img.gz > SHA256SUMS && ls -l )
else
  cp "$WORK/vmlinuz-virt" "$OUT/bzImage"
  # Pre-build the matplotlib font cache (i686 binaries run natively on an x86_64 build host); saves ~60 s on first plot.
  sudo mkdir -p "$RFS/persist/mpl"
  sudo chroot "$RFS" /usr/bin/env HOME=/root MPLCONFIGDIR=/persist/mpl MPLBACKEND=Agg python3 -c "import matplotlib.pyplot as plt; plt.figure()" || echo "warning: font cache not pre-built"
  ZPATH=$(python3 -c "import zstandard,os;print(os.path.dirname(os.path.dirname(zstandard.__file__)))")
  rm -rf "$OUT/fs" "$OUT/fs.json"; mkdir -p "$OUT/fs"
  sudo env PYTHONPATH="$ZPATH" python3 "$HERE/v86-tools/fs2json.py" --zstd --out "$OUT/fs.json" "$RFS"
  sudo env PYTHONPATH="$ZPATH" python3 "$HERE/v86-tools/copy-to-sha256.py" --zstd "$RFS" "$OUT/fs" >/dev/null
  sudo chown -R "$(id -u):$(id -g)" "$OUT"
  ( cd "$OUT" && du -sh fs fs.json bzImage initramfs.gz )
fi
echo "kernel $KVER → $OUT"
