#!/bin/bash
# Blender を MCP ブリッジ付きで起動する。
#   ./launch.sh        GUI（既定。目で見ながら作業できる）
#   ./launch.sh --bg   ヘッドレス（自動化・CI 向け）
set -euo pipefail

BLENDER="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADDON="$HERE/addon.py"

if [ ! -x "$BLENDER" ]; then
  echo "Blender が見つかりません: $BLENDER（BLENDER_BIN で上書きできます）" >&2
  exit 1
fi

# 既に待ち受けていれば二重起動しない（ポートを奪い合うと無言で片方が死ぬ）
if nc -z 127.0.0.1 9876 >/dev/null 2>&1; then
  echo "既に 127.0.0.1:9876 が待ち受け中です"
  exit 0
fi

if [ "${1:-}" = "--bg" ]; then
  # -b ではイベントループが無く bpy.app.timers が発火しない。addon.py 側が
  # bpy.app.background を見てメインスレッドで待ち受ける（そこでブロックする）
  exec "$BLENDER" -b --python "$ADDON"
else
  exec "$BLENDER" --python "$ADDON"
fi
