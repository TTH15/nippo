#!/bin/bash
# 軽バンを組み立て直して .blend と glb を書き出す。
#
#   1) models/keivan.py で部品構成のまま組み立て、.blend を保存
#   2) マテリアル単位に結合して glb を書き出す（Draco 無し）
#   3) 編集を続けられるよう、部品構成に戻す
#
# 前提: launch.sh で Blender が起動していること。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cat "$HERE/models/keivan.py" "$HERE/models/_export_epilogue.py" \
  | python3 "$HERE/bridge.py" exec -

echo
echo "地図に載せる前に仕上げを通すこと（インターリーブ解除・実寸化・原点）:"
echo "  node scripts/prepare-vehicle-glb.mjs \\"
echo "    ~/Developer/assets/hakotora-3d/keivan/keivan_raw.glb \\"
echo "    apps/web/public/models/keivan.glb 3.4 16000 1024 masked '#111827' none"
