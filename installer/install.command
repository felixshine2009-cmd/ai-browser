#!/bin/bash
# AI 浏览器 — 一键安装（双击即可；也可在终端运行）
set -e
cd "$(dirname "$0")"
APP_NAME="AI Browser.app"
ZIP="AI-Browser-mac-arm64.zip"
DEST="/Applications"

echo "=== AI 浏览器安装 ==="
if [ ! -f "$ZIP" ]; then
  echo "找不到 $ZIP。请把本脚本与 $ZIP 放在同一目录后再运行。"
  read -r -p "按回车退出…" _
  exit 1
fi

TMP="$(mktemp -d /tmp/aib-install.XXXXXX)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "1/4 解压…"
ditto -x -k "$ZIP" "$TMP"

if [ ! -d "$TMP/$APP_NAME" ]; then
  # zip 可能把 .app 放在子目录
  FOUND="$(find "$TMP" -maxdepth 3 -type d -name "$APP_NAME" | head -1)"
  if [ -z "$FOUND" ]; then
    echo "解压后未找到 $APP_NAME"; exit 1
  fi
  APP_SRC="$FOUND"
else
  APP_SRC="$TMP/$APP_NAME"
fi

echo "2/4 复制到 $DEST …"
rm -rf "$DEST/$APP_NAME"
cp -R "$APP_SRC" "$DEST/"

echo "3/4 清除隔离属性（未签名应用首次打开必需）…"
xattr -cr "$DEST/$APP_NAME" || true

echo "4/4 启动…"
open "$DEST/$APP_NAME"
echo "完成。应用已安装到 $DEST/$APP_NAME"
