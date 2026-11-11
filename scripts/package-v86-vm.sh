#!/usr/bin/env bash
# Package the iPad Linux VM (v86 + Alpine i686 guest built by vm/build-guest.sh x86) into linux-vm-x86-v86.tar.gz.
# usage: scripts/package-v86-vm.sh <guest-out-dir> <v86-dir> <out.tar.gz>
#   guest-out-dir: bzImage, initramfs.gz, fs.json, fs/      v86-dir: package/build/{libv86.js,v86.wasm}, seabios.bin, vgabios.bin, package/LICENSE
set -euo pipefail
G="$1"; V="$2"; OUT="$3"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; mkdir -p "$T/vm"
cp "$G/bzImage" "$G/initramfs.gz" "$G/fs.json" "$T/vm/"; cp -a "$G/fs" "$T/vm/fs"
cp "$V/package/build/libv86.js" "$V/package/build/v86.wasm" "$V/seabios.bin" "$V/vgabios.bin" "$T/vm/"
cp "$V/package/LICENSE" "$T/vm/LICENSE-v86.txt"
FILES=$(find "$T/vm/fs" -type f | wc -l); BYTES=$(du -sb "$T/vm" | cut -f1)
cat > "$T/vm/manifest.json" <<JSON
{ "name": "AI Browser Linux VM", "version": "alpine-3.22-x86-1", "arch": "i686", "emulator": "v86 0.5.473", "memoryMB": 512, "files": $FILES, "bytes": $BYTES }
JSON
tar -C "$T" -czf "$OUT" vm
rm -rf "$T"
ls -l "$OUT"; echo "unpacked bytes: $BYTES"
