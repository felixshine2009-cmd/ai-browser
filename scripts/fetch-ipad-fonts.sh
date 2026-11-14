#!/usr/bin/env bash
# CJK document fonts for the iPad payload (<payload>/fonts): iPadOS ships PingFang but not Songti / Kaiti, which the
# layout engine uses for serif and kai text. Noto Serif SC (SIL OFL 1.1) and LXGW WenKai (SIL OFL 1.1), pinned + verified.
# usage: scripts/fetch-ipad-fonts.sh <payload-dir> [cache-dir]
set -euo pipefail
OUT="$1/fonts"; CACHE="${2:-${TMPDIR:-/tmp}/aib-fonts}"; mkdir -p "$OUT" "$CACHE"
while read -r name sha url; do
  f="$CACHE/$name"
  if [[ ! -f "$f" ]] || ! echo "$sha  $f" | shasum -a 256 -c - >/dev/null 2>&1; then curl -fsSL --retry 3 -o "$f" "$url"; fi
  echo "$sha  $f" | shasum -a 256 -c - >/dev/null || { echo "checksum mismatch: $name"; exit 1; }
  cp "$f" "$OUT/$name"
done <<'LIST'
NotoSerifSC-Regular.otf e8f396decc1f0963a016a989c3d8852e863d1350996f573860a80767c83a1cd3 https://github.com/notofonts/noto-cjk/raw/Serif2.003/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf
NotoSerifSC-Bold.otf 24693d48bdb9152f0a06b02af625638a1097abd6de4010ebba027f6e82710527 https://github.com/notofonts/noto-cjk/raw/Serif2.003/Serif/SubsetOTF/SC/NotoSerifSC-Bold.otf
LXGWWenKai-Regular.ttf 2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Regular.ttf
LIST
cat > "$OUT/LICENSE-fonts.txt" <<'TXT'
Noto Serif SC (https://github.com/notofonts/noto-cjk) and LXGW WenKai (https://github.com/lxgw/LxgwWenKai)
are licensed under the SIL Open Font License, Version 1.1 (https://openfontlicense.org).
TXT
du -sh "$OUT"
