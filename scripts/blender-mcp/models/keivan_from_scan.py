"""
軽バン（スズキ エブリイ / 日産 NV100 クリッパー）を、Meshy の生成モデルから起こす。

## なぜこの方式か（2026-08-18 に方針転換）

手書きのパラメトリック（`keivan.py`）は「平面を組んで板を貼る」構造のため、
参考画像のような**連続した曲面・はめ込まれた窓・丸い鼻先**が原理的に出せなかった。
Meshy の生成モデルは**形としては既に正解**（窓のはめ込み・ドアライン・フェンダー・
ワイパーまで入っている）ので、それを減面して整える方式に切り替えた。

減面の検証結果（2026-08-18 実測）:

| 三角形数 | 見え方 |
|---|---|
| 1,991,960（原本） | — |
| **39,838** | **原本とほぼ見分けがつかない。静止画用途はこれで十分** |
| 7,966 | 面が波打ち、窓のはめ込みが崩れ始める |
| 2,160 | 形は残るがディテールは溶ける（地図の数十px用途なら可） |

目指す質感は「リアルすぎず、車種・型番の違いが分かる**デジタルツイン**」（ユーザー方針）。
テクスチャは使わず、部位ごとのマテリアルだけで色を分ける。

## 使い方

    python3 scripts/blender-mcp/bridge.py exec scripts/blender-mcp/models/keivan_from_scan.py

生成物は `~/Developer/assets/hakotora-3d/keivan/` へ（git には入れない）。
"""

import math
import os

import bmesh
import bpy
from mathutils import Vector

# 読み込み元は差し替えられる。呼び出し側で先に `SOURCE_OVERRIDE` を定義しておくと
# そちらを使う（車種を増やすときに、このファイルを書き換えずに済む）:
#   { echo 'SOURCE_OVERRIDE = "/path/to.glb"'; cat keivan_from_scan.py; } \
#     | python3 scripts/blender-mcp/bridge.py exec -
SOURCE_GLB = globals().get(
    "SOURCE_OVERRIDE",
    os.path.expanduser(
        "~/Developer/projects/hakotora/apps/web/public/glb/"
        "Meshy_AI_White_Nissan_Clipper__0810125611_generate.glb"
    ),
)
OUTPUT_BLEND = globals().get(
    "OUTPUT_OVERRIDE",
    os.path.expanduser("~/Developer/assets/hakotora-3d/keivan/keivan_work.blend"),
)

# ── 実車の寸法（スズキ エブリイ DA17V） ───────────────────────────────
LENGTH = 3.395
WIDTH = 1.475
# 生成モデルは長さを合わせると**幅が 5.6% 太い**（実測 1.557 / 実車 1.475）ので Y だけ詰める
SOURCE_BODY_WIDTH = 1.557

DECIMATE_RATIO = 0.02  # 約 40,000 三角形。静止画用途

# ── 部位の位置（生成モデルを全長 3.395m へ正規化した後の実測値） ──────
# ★この生成モデルは**前が -X**（ミラーの張り出し位置から確定）
AXLE_FRONT_X = -1.100
AXLE_REAR_X = 1.100
AXLE_Z = 0.350
TIRE_OUTER_R = 0.335   # タイヤ外周
RIM_R = 0.205          # ここより内側はリム（銀）
WHEEL_MIN_ABS_Y = 0.52
WHEEL_MAX_Z = 0.70     # ★これが無いと、車輪の近くの裾（ロッカー）まで黒くなる

BELT_Z = 1.14          # ベルトライン（窓の下端）
ROOF_Z = 1.80          # ルーフ（窓の上端）
GLASS_RECESS = 0.012   # 窓は車体面よりこれ以上へこんでいる

MATERIALS = {
    "body": ((0.86, 0.87, 0.88, 1.0), 0.42),
    "glass": ((0.10, 0.11, 0.14, 1.0), 0.15),
    "tire": ((0.055, 0.055, 0.065, 1.0), 0.90),
    "rim": ((0.74, 0.75, 0.77, 1.0), 0.35),
    "plate": ((0.93, 0.82, 0.22, 1.0), 0.50),  # 軽の自家用は黄色。事業用は描画側で黒く
}
MATERIAL_ORDER = ["body", "glass", "tire", "rim", "plate"]


def _socket(node, identifier):
    """ソケットは identifier で引く。UI 言語が日本語だと name は翻訳される。"""
    for sock in node.inputs:
        if sock.identifier == identifier:
            return sock
    return None


def make_material(key):
    color, roughness = MATERIALS[key]
    name = f"keivan_{key}"
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        raise RuntimeError(f"{name}: Principled BSDF が見つからない")
    _socket(bsdf, "Base Color").default_value = color
    _socket(bsdf, "Roughness").default_value = roughness
    mat.diffuse_color = color
    return mat


def import_and_normalize():
    """生成モデルを読み込み、実寸・原点・向きを揃える。

    原点=底面中心 / 前は -Y（Blender の Front ビューが車の正面）/ 全長 3.395m。
    """
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SOURCE_GLB)
    obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    obj.name = "keivan"

    def world_bounds():
        lo = Vector((1e9,) * 3)
        hi = Vector((-1e9,) * 3)
        for c in obj.bound_box:
            w = obj.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
        return lo, hi

    lo, hi = world_bounds()
    size = hi - lo
    scale = LENGTH / max(size.x, size.y)
    # ★生成モデルは長さを合わせると幅が余る。車種ごとに違うので**実測して**詰める
    #   （ミラーを避けるため、車体中央付近の断面で測る）
    mid_x = (lo.x + hi.x) / 2
    band = [
        (obj.matrix_world @ v.co)
        for v in obj.data.vertices
    ]
    body_ys = [
        w.y for w in band
        if abs(w.x - mid_x) < size.x * 0.12 and lo.z + size.z * 0.3 < w.z < lo.z + size.z * 0.65
    ]
    measured_w = (max(body_ys) - min(body_ys)) * scale if body_ys else WIDTH
    y_fix = WIDTH / measured_w if measured_w > 0 else 1.0
    print(f"実測の車体幅 {measured_w:.3f}m -> 実車 {WIDTH}m（Y を {y_fix:.3f} 倍）")
    obj.scale = (scale, scale * y_fix, scale)
    bpy.context.view_layer.update()

    lo, hi = world_bounds()
    center = (lo + hi) / 2
    obj.location = (
        obj.location.x - center.x,
        obj.location.y - center.y,
        obj.location.z - lo.z,
    )
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def decimate(obj, ratio=DECIMATE_RATIO):
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def _in_box(c, box, margin=0.0):
    xmin, xmax, ymin, ymax, zmin, zmax = box
    return (
        xmin - margin <= c.x <= xmax + margin
        and ymin - margin <= c.y <= ymax + margin
        and zmin - margin <= c.z <= zmax + margin
    )


def _flood_flat(bm, seed, box, max_angle_deg=34.0, limit=20000):
    """seed の面から、折れ目を越えずに繋がった面を集める。**箱の外へは出ない**。

    ★窓は車体面から段差で凹んでいる。位置だけの判定では（減面後は面が大きいので）
      白い三角が窓に混ざり、裾に黒い斑が出た。一方、角度だけの塗りつぶしは
      減面で段差が丸まっているため**車体全体へ逃げて配色が反転した**（実測）。
      角度で広げつつ、箱で拘束するのが確実。
    """
    threshold = math.radians(max_angle_deg)
    seen = {seed}
    stack = [seed]
    while stack and len(seen) < limit:
        f = stack.pop()
        for e in f.edges:
            for nf in e.link_faces:
                if nf is f or nf in seen:
                    continue
                if not _in_box(nf.calc_center_median(), box, margin=0.02):
                    continue
                if f.normal.length == 0 or nf.normal.length == 0:
                    continue
                if f.normal.angle(nf.normal) <= threshold:
                    seen.add(nf)
                    stack.append(nf)
    return seen


def _seed_face(bm, box, outward):
    """箱の中で「外を向いていて、いちばん奥まっている面」を種にする。

    外向き判定を入れないと車内側の面を掴み、そこから塗りつぶしが暴走する。
    """
    out = Vector(outward).normalized()
    best = None
    best_depth = None
    for f in bm.faces:
        c = f.calc_center_median()
        if not _in_box(c, box):
            continue
        if f.normal.length == 0 or f.normal.normalized().dot(out) < 0.35:
            continue
        depth = c.dot(out)  # 外向き方向で見て、いちばん内側＝凹んでいる
        if best_depth is None or depth < best_depth:
            best_depth = depth
            best = f
    return best


def assign_materials(obj):
    """部位ごとにマテリアルを割り当てる。

    生成モデルは**テクスチャもマテリアルも持たない単一メッシュ**なので、
    「どこにあるか（位置）」と「どこまで繋がっているか（折れ目）」で分ける。
    """
    mesh = obj.data
    mesh.materials.clear()
    for key in MATERIAL_ORDER:
        mesh.materials.append(make_material(key))
    index = {key: i for i, key in enumerate(MATERIAL_ORDER)}

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bm.normal_update()

    for f in bm.faces:
        f.material_index = index["body"]

    # ── 窓（前=-X）。左右の側面窓・フロント・リアそれぞれに種を置いて塗りつぶす ──
    glass_targets = []
    for sign in (1, -1):
        y_lo, y_hi = (0.45, 0.95) if sign > 0 else (-0.95, -0.45)
        outward = (0, sign, 0)
        glass_targets += [
            ((-0.62, -0.18, y_lo, y_hi, 1.22, 1.62), outward),   # 運転席ドア
            ((0.08, 0.52, y_lo, y_hi, 1.22, 1.62), outward),     # スライドドア
            ((0.93, 1.37, y_lo, y_hi, 1.22, 1.62), outward),     # クォーター
        ]
    glass_targets += [
        ((-1.25, -0.72, -0.35, 0.35, 1.28, 1.68), (-1, 0, 0)),   # フロントガラス
        ((1.50, 1.72, -0.35, 0.35, 1.20, 1.68), (1, 0, 0)),      # リアガラス
    ]
    glass_faces = set()
    for box, outward in glass_targets:
        seed = _seed_face(bm, box, outward)
        if seed is None:
            continue
        glass_faces |= _flood_flat(bm, seed, box, max_angle_deg=38.0, limit=4000)
    for f in glass_faces:
        f.material_index = index["glass"]

    # ── 車輪。軸からの距離＋「外を向いているか」で分ける ──
    # ★距離だけだと**フェンダー内側のライナー**まで拾って、アーチに黒い楔が出る。
    #   タイヤのトレッドは軸から見て外向き、側面とリムは ±Y 向き。それ以外は車体側。
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(c.y) < WHEEL_MIN_ABS_Y or c.z > WHEEL_MAX_Z:
            continue
        n = f.normal
        if n.length == 0:
            continue
        n = n.normalized()
        for axle_x in (AXLE_FRONT_X, AXLE_REAR_X):
            dx, dz = c.x - axle_x, c.z - AXLE_Z
            d = math.hypot(dx, dz)
            if d > TIRE_OUTER_R:
                continue
            facing_side = abs(n.y) > 0.55                       # 側面（リム・サイドウォール）
            facing_out = d > 1e-6 and (n.x * dx + n.z * dz) / d > 0.30  # トレッド
            if not (facing_side or facing_out):
                break                                           # ライナー等は車体のまま
            f.material_index = index["rim"] if (d <= RIM_R and facing_side) else index["tire"]
            break

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return obj


def mark_sharp_edges(obj, angle_deg=30.0):
    """折れ目に「シャープ」の印を付ける。

    ★手でマテリアルを塗るときの要。Blender の
      「選択 → 拡張縮小 → 平坦な面を選択」は、この折れ目で止まる。
      窓の中の面を1つ選んでこれを実行すれば、窓だけがまとめて選べる。
    """
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    threshold = math.radians(angle_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            a, b = e.link_faces
            if a.normal.length and b.normal.length and a.normal.angle(b.normal) > threshold:
                e.smooth = False
    bm.to_mesh(mesh)
    bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    return obj


def setup_viewport_for_editing(obj):
    """開いた直後から塗り分け作業に入れる状態にする（Blender 未経験者向け）。"""
    for area in bpy.context.screen.areas if bpy.context.screen else []:
        if area.type != "VIEW_3D":
            continue
        for space in area.spaces:
            if space.type == "VIEW_3D":
                space.shading.type = "MATERIAL"   # 色が見える表示
                space.shading.show_xray = False
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj


def build():
    obj = import_and_normalize()
    decimate(obj, globals().get("DECIMATE_OVERRIDE", DECIMATE_RATIO))
    # ★窓などの自動塗り分けは、判定用の座標が**車種ごとに違う**ため他車では破綻する
    #   （2026-08-20: クリッパー向けの座標をシティバンに当てて黒い破片が散った）。
    #   新しい車種では切っておき、真っ白な状態から手で塗るほうが速い。
    if globals().get("ASSIGN_MATERIALS", True):
        assign_materials(obj)
    else:
        mesh = obj.data
        mesh.materials.clear()
        mesh.materials.append(make_material("body"))
        for key in MATERIAL_ORDER[1:]:
            mesh.materials.append(make_material(key))
        for p in mesh.polygons:
            p.material_index = 0
    mark_sharp_edges(obj)
    setup_viewport_for_editing(obj)
    return obj


obj = build()

# `OUTPUT_OVERRIDE` が指定されていれば .blend として保存する。
# ★以前はここが無く、`OUTPUT_OVERRIDE` を渡しても**何も保存されなかった**（2026-08-20）。
if globals().get("OUTPUT_OVERRIDE"):
    os.makedirs(os.path.dirname(OUTPUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)

dg = bpy.context.evaluated_depsgraph_get()
m = obj.evaluated_get(dg).to_mesh()
tris = sum(max(len(p.vertices) - 2, 0) for p in m.polygons)
obj.evaluated_get(dg).to_mesh_clear()
counts = {}
for p in obj.data.polygons:
    name = obj.data.materials[p.material_index].name
    counts[name] = counts.get(name, 0) + 1
result = f"{tris:,} 三角形 / 面の内訳: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
if globals().get("OUTPUT_OVERRIDE"):
    result += f" -> {OUTPUT_BLEND}"
print(result)
