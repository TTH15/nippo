"""
軽バンのフロントまわりを塗り分ける（グリルの奥・ヘッドライト・開口部）。

参考画像と並べると、形は同じなのに**前が白い塊に見える**のが最大の差だった。
実車はグリルのスリットの奥が暗く、ヘッドライトのレンズが黒い。
形（スリット）はモデルに存在するので、これは塗り分けの問題。

## 判定のしかた

グリルの凹みは**絶対座標では切れない**（前面が曲面なので、奥行きの分布が連続になる。
2026-08-19 実測）。そこで (y, z) の格子ごとに「その位置での前端」を求め、
そこからどれだけ奥かで判定する。窓のときと同じ考え方。

## 使い方

    python3 scripts/blender-mcp/bridge.py exec scripts/blender-mcp/models/keivan_front_detail.py

★入力の .blend は**上書きしない**。`_front.blend` として別名保存する。
"""

import os

import bmesh
import bpy

SOURCE = os.path.expanduser("~/Developer/assets/hakotora-3d/keivan/keivan_work.blend")
OUTPUT = os.path.expanduser("~/Developer/assets/hakotora-3d/keivan/keivan_work_front.blend")

# 前は -X。前面まわりだけを対象にする
FRONT_DEPTH = 0.34        # 前端からこの範囲を「フロント」とみなす
CELL = 0.035              # (y,z) 格子の粗さ。細かすぎると凹みの底を基準にしてしまう
RECESS_MIN = 0.022        # 周囲の前端からこれ以上奥なら「凹み＝暗い部分」
GRILLE_Z = (0.42, 1.16)   # グリル・開口部の高さ範囲
GRILLE_ABS_Y = 0.66

# ヘッドライト（前面の左右上）。凹みではないので位置で取る
HEADLIGHT_X = 0.30        # 前端からの奥行き
HEADLIGHT_Y = (0.40, 0.72)
HEADLIGHT_Z = (0.92, 1.22)

NEW_MATERIALS = {
    "keivan_dark": ((0.075, 0.08, 0.09, 1.0), 0.62),       # グリルの奥・開口部
    "keivan_headlight": ((0.26, 0.27, 0.30, 1.0), 0.22),   # スモークのレンズ
}


def _socket(node, identifier):
    """ソケットは identifier で引く（UI 言語が日本語だと name は翻訳される）。"""
    for sock in node.inputs:
        if sock.identifier == identifier:
            return sock
    return None


def ensure_material(name, color, roughness):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    # ノードは名前ではなく type で引く（同上）
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        raise RuntimeError(f"{name}: Principled BSDF が見つからない")
    _socket(bsdf, "Base Color").default_value = color
    _socket(bsdf, "Roughness").default_value = roughness
    mat.diffuse_color = color
    return mat


def run():
    bpy.ops.wm.open_mainfile(filepath=SOURCE)
    obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    mesh = obj.data

    slot = {}
    for i, m in enumerate(mesh.materials):
        slot[m.name] = i
    for name, (color, rough) in NEW_MATERIALS.items():
        mat = ensure_material(name, color, rough)
        if name not in slot:
            mesh.materials.append(mat)
            slot[name] = len(mesh.materials) - 1

    body_index = slot.get("keivan_body", 0)

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()

    front_x = min(v.co.x for v in bm.verts)

    # (y,z) 格子ごとの「その位置での前端」を作る
    surface = {}
    targets = []
    for f in bm.faces:
        c = f.calc_center_median()
        if c.x > front_x + FRONT_DEPTH:
            continue
        if abs(c.y) > GRILLE_ABS_Y or not (GRILLE_Z[0] <= c.z <= GRILLE_Z[1]):
            continue
        key = (round(c.y / CELL), round(c.z / CELL))
        surface[key] = min(surface.get(key, 1e9), c.x)
        targets.append((f, key, c))

    dark = 0
    for f, key, c in targets:
        # 既に塗られている面（プレート等）は触らない
        if f.material_index != body_index:
            continue
        if c.x - surface[key] >= RECESS_MIN:
            f.material_index = slot["keivan_dark"]
            dark += 1

    lights = 0
    for f in bm.faces:
        c = f.calc_center_median()
        if c.x > front_x + HEADLIGHT_X:
            continue
        if not (HEADLIGHT_Y[0] <= abs(c.y) <= HEADLIGHT_Y[1]):
            continue
        if not (HEADLIGHT_Z[0] <= c.z <= HEADLIGHT_Z[1]):
            continue
        if f.material_index != body_index:
            continue
        f.material_index = slot["keivan_headlight"]
        lights += 1

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT)
    return dark, lights


dark, lights = run()
result = f"グリル等の凹み {dark} 面 / ヘッドライト {lights} 面 -> {OUTPUT}"
print(result)
