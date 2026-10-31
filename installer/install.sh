#!/bin/bash
# AI 浏览器 — 终端一键安装（与 install.command 相同逻辑）
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$DIR/install.command"
