#!/usr/bin/env bash
# Assemble the PWA (web/ + GeoGebra bundle + physics sim/examples) into <outdir>; optional 3rd mode "zip" writes dist-web.zip.
# usage: scripts/build-web.sh <outdir> [zip]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${1:-$ROOT/dist-web}"
rm -rf "$OUT"; mkdir -p "$OUT"
( cd "$ROOT/web" && find . -mindepth 1 -maxdepth 1 ! -name ggb ! -name physics -exec cp -a {} "$OUT/" \; )
mkdir -p "$OUT/ggb" "$OUT/physics"
cp -a "$ROOT/extensions/builtin/geogebra/ggb/." "$OUT/ggb/"
cp "$ROOT/extensions/builtin/physics/sim.js" "$ROOT/extensions/builtin/physics/modules.js" "$OUT/physics/"; node "$ROOT/scripts/sync-web-physics.js" "$OUT/panels-phys.html"; cp -a "$ROOT/extensions/builtin/physics/examples" "$OUT/physics/"
touch "$OUT/.nojekyll"
if [ "${2:-}" = "zip" ]; then
  python3 - "$OUT" "$ROOT/dist-web.zip" <<'PY'
import sys,os,zipfile
src,out=sys.argv[1:3]
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for d,_,fs in os.walk(src):
        for f in fs:
            p=os.path.join(d,f); z.write(p,os.path.relpath(p,src))
PY
fi
echo "built $OUT"
