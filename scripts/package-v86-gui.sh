#!/usr/bin/env bash
# Package the iPad graphical VM image as a delta over the bundled base image (first-use download):
#   linux-vm-x86-gui.tar = fs.json (graphical image tree) + fs/<blob> for every file that is not in the base image.
# usage: scripts/package-v86-gui.sh <base-guest-dir> <gui-guest-dir> <out.tar>
#   base-guest-dir: the image packaged by package-v86-vm.sh (fs.json, fs/); gui-guest-dir: GUI=1 vm/build-guest.sh x86 output
set -euo pipefail
B="$1"; G="$2"; OUT="$3"
T="$(mktemp -d)"; mkdir -p "$T/fs"
cp "$G/fs.json" "$T/fs.json"
n=0; for f in "$G"/fs/*; do b=$(basename "$f"); [ -e "$B/fs/$b" ] || { cp "$f" "$T/fs/$b"; n=$((n+1)); }; done
tar -C "$T" -cf "$OUT" fs.json fs
rm -rf "$T"
echo "new blobs: $n"; ls -l "$OUT"
