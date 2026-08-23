#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$ROOT/Modules/EditorRuntime"
BUN="$RUNTIME/runtime/bun-arm64"
FFMPEG="$RUNTIME/media/ffmpeg"
FFPROBE="$RUNTIME/media/ffprobe"
EDITOR="$RUNTIME/editor-desktop"
SCRIPT="$EDITOR/src/main.mjs"

fail() {
  echo ""
  echo "$1"
  echo ""
  read -k 1 "?按任意键退出…"
  exit 1
}

ARCH="$(uname -m)"
if [[ "$ARCH" == "x86_64" ]]; then
  TRANSLATED="$(/usr/sbin/sysctl -in sysctl.proc_translated 2>/dev/null || printf 0)"
  if [[ "$TRANSLATED" == "1" ]]; then ARCH="arm64"; fi
fi
[[ "$ARCH" == "arm64" ]] || fail "当前测试包只支持 Apple 芯片 Mac（M1 / M2 / M3 / M4）。"

[[ -f "$SCRIPT" ]] || fail "找不到编辑器：Modules/EditorRuntime/editor-desktop/src/main.mjs"

# Auto-clear Gatekeeper quarantine and restore execution permissions
/usr/bin/xattr -cr "$ROOT" >/dev/null 2>&1 || true
/bin/chmod -R +x "$RUNTIME" 2>/dev/null || true

RUNNER=""
if [[ -f "$BUN" && -x "$BUN" ]]; then
  RUNNER="$BUN"
elif command -v bun >/dev/null 2>&1; then
  RUNNER="$(command -v bun)"
elif command -v node >/dev/null 2>&1; then
  RUNNER="$(command -v node)"
else
  fail "缺少运行组件：未找到内置 Bun 或系统 Node.js。"
fi

[[ -f "$FFMPEG" && -f "$FFPROBE" ]] || fail "找不到 FFmpeg / FFprobe。"

export QUICKCUT_MEDIA_ROOT="$RUNTIME/media"
unset QUICKCUT_APP_EXECUTABLE
unset QUICKCUT_NO_WINDOW
cd "$EDITOR"

echo "============================================="
echo " 快剪 QuickCut · 智能视频剪辑与字幕对齐"
echo "============================================="
echo "正在启动编辑器…"
echo "关闭这个终端窗口即可退出后台服务。"
echo ""

exec "$RUNNER" "$SCRIPT"
