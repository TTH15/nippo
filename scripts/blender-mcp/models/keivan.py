"""
軽バン（キャブオーバー）の様式化ローポリモデル。

このスクリプトが**モデルの正本**。.blend / .glb は成果物であって git には入れない
（`~/Developer/assets/hakotora-3d/` に置く）。形を直すときはここの数値を直す。

方針（memory: hakotora-3d-models）:
- 目指すのは Google マップ型の様式化。写真起こしではなく、面を意図的に少なく保つ
- 車体は**白**にしておく。地図側で model-color を乗算して着色するため
- 窓・タイヤは暗いまま残す（乗算しても暗いので、車体だけ色が乗る）
- Draco は使わない

実寸（軽自動車規格の上限に近い実車＝スズキ・エブリイ相当）:
    全長 3.395m / 全幅 1.475m / 全高 1.895m
原点は**底面中心**、車体は**-Y を向く**（Blender の Front ビュー＝車の正面。車のモデリングの慣習）。

実行:
    python3 scripts/blender-mcp/bridge.py exec scripts/blender-mcp/models/keivan.py
"""

import bmesh
import bpy
from mathutils import Matrix, Vector

# ── 寸法 ────────────────────────────────────────────────────────────────
LENGTH = 3.395
WIDTH = 1.475
HEIGHT = 1.895

HALF_L = LENGTH / 2
HALF_W = WIDTH / 2

WHEEL_RADIUS = 0.29
WHEEL_WIDTH = 0.155
WHEELBASE = 2.41
AXLE_Z = WHEEL_RADIUS

BODY_BOTTOM = 0.30
ROOF = HEIGHT - 0.02

# 側面シルエット（X=前後, Z=上下）。組み立て中は前が +X。最後に -Y 向きへ回す。
# ★キャブオーバーなので「鼻はほぼ無い」。フロントガラスは立ち、前面は垂直に近い。
#   ここを寝かせると宅配トラックに見える（初回の失敗）。
P_ROOF_REAR = (-HALF_L + 0.10, ROOF)
P_ROOF_FRONT = (HALF_L - 0.70, ROOF)
P_WS_BASE = (HALF_L - 0.18, ROOF - 0.66)      # フロントガラス下端
P_COWL = (HALF_L - 0.04, ROOF - 0.80)         # ごく短いボンネット
P_FACE_TOP = (HALF_L, ROOF - 0.95)            # 前面上端
P_FACE_LOW = (HALF_L, BODY_BOTTOM + 0.30)     # 前面下（バンパー）

SIDE_PROFILE = [
    (-HALF_L + 0.03, BODY_BOTTOM),
    (-HALF_L, BODY_BOTTOM + 0.20),
    (-HALF_L, ROOF - 0.14),
    P_ROOF_REAR,
    P_ROOF_FRONT,
    P_WS_BASE,
    P_COWL,
    P_FACE_TOP,
    P_FACE_LOW,
    (HALF_L - 0.07, BODY_BOTTOM),
]

BODY_COLOR = (0.88, 0.88, 0.89, 1.0)   # 白。地図側で乗算して着色する
GLASS_COLOR = (0.07, 0.08, 0.10, 1.0)
TIRE_COLOR = (0.05, 0.05, 0.06, 1.0)

GLASS_OFFSET = 0.008  # 車体表面からの浮かせ量。Zファイティングを避ける最小限


def _material(name, color, roughness=0.55):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
    mat.diffuse_color = color  # Workbench プレビュー用
    return mat


def _clear_scene():
    for obj in list(bpy.data.objects):
        if obj.type == "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def _new_mesh_object(name):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj, mesh


def _build_body():
    obj, mesh = _new_mesh_object("keivan_body")
    bm = bmesh.new()
    verts = [bm.verts.new((x, -HALF_W, z)) for x, z in SIDE_PROFILE]
    bm.faces.new(verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ret = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    moved = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, WIDTH, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    # ★絞りは「窓より上」だけに留める。側面の窓が乗る帯を垂直に保たないと、
    #   平板の窓がめり込む（初回の失敗）。裾は軽く絞って腰高に見せない。
    for v in bm.verts:
        if v.co.z > ROOF - 0.10:
            v.co.y *= 0.95
        elif v.co.z < BODY_BOTTOM + 0.10:
            v.co.y *= 0.96

    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(_material("keivan_body", BODY_COLOR))

    bevel = obj.modifiers.new("bevel", "BEVEL")
    bevel.width = 0.06
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = 0.45
    return obj


def _add_side_glass(name, points, sign):
    """側面に貼る平板。points は (x, z)。sign は左右。"""
    obj, mesh = _new_mesh_object(name)
    y = sign * (HALF_W + GLASS_OFFSET)
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, z)) for x, z in points]
    face = bm.faces.new(verts)
    if face.normal.y * sign < 0:
        face.normal_flip()
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(_material("keivan_glass", GLASS_COLOR, roughness=0.25))
    return obj


def _add_spanning_glass(name, p1, p2, half_width, inset=0.055):
    """前後の窓。側面シルエットの1区間 (p1→p2) を幅方向に張る。

    区間の法線方向へ少しだけ浮かせるので、フロントガラスのような
    斜めの面でも車体に沿って乗る。
    """
    obj, mesh = _new_mesh_object(name)
    a = Vector((p1[0], 0.0, p1[1]))
    b = Vector((p2[0], 0.0, p2[1]))
    edge = (b - a).normalized()
    # X-Z 平面内で 90 度回した向き＝この面の外向き法線
    normal = Vector((edge.z, 0.0, -edge.x))
    # ★「x が正なら外」ではない。後ろ側の面は -X が外なので、車体中心から
    #   離れる向きかどうかで判定する（リアガラスが内側に沈んで消えていた）
    mid = (a + b) / 2
    center = Vector((0.0, 0.0, (BODY_BOTTOM + ROOF) / 2))
    if normal.dot(mid - center) < 0:
        normal = -normal
    shift = normal * GLASS_OFFSET
    a_in = a + edge * inset + shift
    b_in = b - edge * inset + shift

    w = half_width
    bm = bmesh.new()
    verts = [
        bm.verts.new((a_in.x, -w, a_in.z)),
        bm.verts.new((b_in.x, -w, b_in.z)),
        bm.verts.new((b_in.x, w, b_in.z)),
        bm.verts.new((a_in.x, w, a_in.z)),
    ]
    bm.faces.new(verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(_material("keivan_glass", GLASS_COLOR, roughness=0.25))
    return obj


def _add_wheel(name, x, y):
    """タイヤ。地図上では数十pxなので 14 角柱で十分。"""
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=14,
        radius=WHEEL_RADIUS,
        depth=WHEEL_WIDTH,
        location=(x, y, AXLE_Z),
        rotation=(1.5707963, 0, 0),
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(_material("keivan_tire", TIRE_COLOR, roughness=0.9))
    return obj


def build():
    _clear_scene()
    parts = [_build_body()]

    # 窓の帯（垂直な側面の範囲に収める）
    belt_top = ROOF - 0.16
    belt_bottom = ROOF - 0.68
    # ★前端は A ピラー（ルーフ前端→ガラス下端の線）より後ろに収める。
    #   越えると窓が車体からはみ出した黒い舌のように飛び出す（2回目の失敗）
    front_side = [
        (P_ROOF_FRONT[0] + 0.06, belt_top),
        (P_ROOF_FRONT[0] + 0.20, belt_bottom),
        (HALF_L - 1.30, belt_bottom),
        (HALF_L - 1.30, belt_top),
    ]
    rear_side = [
        (HALF_L - 1.36, belt_top),
        (HALF_L - 1.36, belt_bottom),
        (-HALF_L + 0.15, belt_bottom),
        (-HALF_L + 0.15, belt_top),
    ]
    for sign in (1, -1):
        parts.append(_add_side_glass(f"keivan_glass_side_front_{'l' if sign > 0 else 'r'}", front_side, sign))
        parts.append(_add_side_glass(f"keivan_glass_side_rear_{'l' if sign > 0 else 'r'}", rear_side, sign))

    # フロントガラス（ルーフ前端 → ガラス下端の区間）
    parts.append(_add_spanning_glass("keivan_glass_windshield", P_ROOF_FRONT, P_WS_BASE, HALF_W * 0.86))
    # リアガラス（後面の上側）
    parts.append(
        _add_spanning_glass(
            "keivan_glass_rear",
            (-HALF_L, ROOF - 0.14),
            (-HALF_L, ROOF - 0.72),
            HALF_W * 0.84,
            inset=0.02,
        )
    )

    tread = HALF_W - WHEEL_WIDTH / 2 + 0.012
    for label, x in (("front", WHEELBASE / 2), ("rear", -WHEELBASE / 2)):
        for sign in (1, -1):
            parts.append(_add_wheel(f"keivan_wheel_{label}_{'l' if sign > 0 else 'r'}", x, sign * tread))

    # 前を -Y へ向ける（Blender の Front ビューが車の正面になる）
    rot = Matrix.Rotation(-1.5707963267948966, 4, "Z")
    for obj in parts:
        obj.data.transform(rot @ obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)
        obj.data.update()

    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    return parts


built = build()
result = f"{len(built)} parts"
print(result)
