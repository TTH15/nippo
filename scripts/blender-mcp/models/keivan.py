"""
軽バン（キャブオーバー）のローポリモデル。スズキ エブリイ DA17V 相当。

このスクリプトが**モデルの正本**。.blend / .glb は成果物であって git には入れない
（`~/Developer/assets/hakotora-3d/` に置く）。形を直すときはここの数値を直す。

## 部品構成

    KeiVan (Empty)
     ├─ body            車体（側面シルエットの押し出し＋フェンダーのくり抜き）
     ├─ windshield / side_window ×6 / rear_window
     ├─ front_grille ×3 / headlight ×2 / front_intake / taillight ×2
     ├─ bumper ×2
     ├─ door_line ×4 / door_handle ×4
     ├─ wheel ×4       タイヤ＋リム（**メッシュ共有**＝1つ直せば4つとも直る）
     ├─ mirror ×2
     └─ plate ×2       ナンバープレート

分ける目的ごとに層が違う:

- **色** はオブジェクトではなく**マテリアル**で決まる。Mapbox の `model-color` は
  モデル全体に掛かるため、白い面は着色され、暗い面（窓・タイヤ）は暗いまま残る
- **使い回し** はメッシュデータの共有（リンク複製）で効かせる
- **書き出し** では `join_by_material()` でマテリアル単位に結合してから出す

## 実寸

全長 3.395m / 全幅 1.475m / 全高 1.895m。原点は**底面中心**、車体は**-Y を向く**。

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

WHEEL_RADIUS = 0.30
WHEEL_WIDTH = 0.15
RIM_RADIUS = 0.175
# 前後オーバーハングは非対称（前が短い）。実測: 前輪中心 前端から0.41m / 後輪中心 後端から0.55m
AXLE_FRONT_X = HALF_L - 0.44
AXLE_REAR_X = -HALF_L + 0.55
AXLE_Z = WHEEL_RADIUS
ARCH_RADIUS = 0.39  # フェンダーのくり抜き半径。タイヤより一回り大きく

BODY_BOTTOM = 0.28
ROOF = HEIGHT - 0.02

# 側面シルエット（X=前後, Z=上下）。組み立て中は前が +X。最後に -Y 向きへ回す。
#
# ★2026-08-18: 目分量で作ったら「ハイエースのような大きいバン」になった。
#   参照モデル（日産 NV100 クリッパー＝エブリイ OEM）を Blender に読み込み、
#   全長 3.395m へ正規化して**輪郭を実測**し、その値で組み直した。
#   実測して分かった、軽バンらしさを決める2点:
#     1. **前面は z=1.10 付近までほぼ垂直**（自分のは z=0.94 から寝ていた）
#     2. **平らなルーフが始まるのは前端から 1.20m**（自分のは 0.72m ＝ 早すぎた）。
#        A ピラーからルーフへの立ち上がりが長く、そこが緩い曲線になっている
#   ルーフが早く始まるほど「長い箱」に見え、大型バンの印象になる。
P_FRONT_LOW = (HALF_L - 0.05, BODY_BOTTOM)
P_FACE_LOW = (HALF_L, BODY_BOTTOM + 0.16)
P_FACE_TOP = (HALF_L - 0.01, 1.05)      # ここまで前面はほぼ垂直
P_COWL = (HALF_L - 0.10, 1.14)
P_WS_BASE = (HALF_L - 0.34, 1.25)       # フロントガラス下端
P_WS_MID = (HALF_L - 0.63, 1.56)
P_WS_TOP = (HALF_L - 0.95, 1.82)
P_ROOF_FRONT = (HALF_L - 1.20, ROOF)
P_ROOF_REAR = (-HALF_L + 0.09, ROOF)
P_REAR_TOP = (-HALF_L, ROOF - 0.13)
P_REAR_LOW = (-HALF_L, BODY_BOTTOM + 0.16)

SIDE_PROFILE = [
    (-HALF_L + 0.04, BODY_BOTTOM),
    P_REAR_LOW,
    P_REAR_TOP,
    P_ROOF_REAR,
    P_ROOF_FRONT,
    P_WS_TOP,
    P_WS_MID,
    P_WS_BASE,
    P_COWL,
    P_FACE_TOP,
    P_FACE_LOW,
    P_FRONT_LOW,
]

# 窓の帯（垂直な側面の範囲に収める）
BELT_TOP = ROOF - 0.10
BELT_BOTTOM = 1.25   # フロントガラス下端と同じ高さでベルトラインが繋がる（実測）

# ドアの区切り（X）。実車は 運転席ドア / スライドドア / クォーター の3枚
DOOR_FRONT_REAR_EDGE = 0.11    # 運転席ドアの後端（実測）
SLIDE_DOOR_REAR_EDGE = -0.77   # スライドドアの後端（実測）

SURFACE_OFFSET = 0.008  # 車体表面からの浮かせ量。Zファイティングを避ける最小限

# ── マテリアル（色の正本。ここだけ見れば配色が分かる） ──────────────────
#
# 車体は**白**にしておく。地図側で model-color を乗算して着色するため。
# 暗い部品は乗算しても暗いままなので、車体だけ色が乗る。
MATERIALS = {
    "body": ((0.88, 0.88, 0.89, 1.0), 0.45),
    "glass": ((0.07, 0.08, 0.10, 1.0), 0.20),
    "tire": ((0.05, 0.05, 0.06, 1.0), 0.90),
    "rim": ((0.72, 0.73, 0.75, 1.0), 0.35),    # ホイールのリム（銀）
    "trim": ((0.17, 0.18, 0.20, 1.0), 0.65),   # バンパー下・グリル・ミラー・ドアライン
    # ★白い車体に明るいライトを置くと完全に消える（実測）。グリル(暗)と車体(白)の
    #   両方から浮く中間の明度にする
    "light": ((0.46, 0.48, 0.52, 1.0), 0.25),  # ヘッドライト
    "taillight": ((0.55, 0.11, 0.11, 1.0), 0.30),
    "plate": ((0.95, 0.95, 0.93, 1.0), 0.55),  # ナンバープレート（事業用は描画側で黒く）
}


def _socket(node, identifier):
    """ソケットを identifier で引く。

    ★UI 言語が日本語だと `node.name` も `socket.name` も翻訳される
      （ノード名は「プリンシプルBSDF」）。名前で引くと必ず None になり、
      **色の設定が黙って無視される**（Workbench は diffuse_color を見るので
      プレビューだけ正しく見えて気づけない。2026-08-18 実測）。
    """
    for sock in node.inputs:
        if sock.identifier == identifier:
            return sock
    return None


def material(key):
    color, roughness = MATERIALS[key]
    name = f"keivan_{key}"
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        raise RuntimeError(f"{name}: Principled BSDF が見つからない")
    base = _socket(bsdf, "Base Color")
    rough = _socket(bsdf, "Roughness")
    if base is None or rough is None:
        raise RuntimeError(f"{name}: Base Color / Roughness ソケットが見つからない")
    base.default_value = color
    rough.default_value = roughness
    mat.diffuse_color = color  # Workbench プレビュー用（glTF はノード側を見る）
    return mat


# ── 組み立ての足回り ────────────────────────────────────────────────────


def _clear_scene():
    for obj in list(bpy.data.objects):
        if obj.type in {"MESH", "EMPTY"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)


def _mesh_from_bmesh(name, bm, material_key):
    mesh = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material(material_key))
    return mesh


def _instance(name, mesh, location=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    """メッシュを共有したままオブジェクトだけ増やす（リンク複製）。"""
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.rotation_euler = rotation
    obj.scale = scale
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _quad(points_xz, y_min, y_max):
    """X-Z 平面の2点 + 幅で作る板。"""
    (x1, z1), (x2, z2) = points_xz
    bm = bmesh.new()
    verts = [
        bm.verts.new((x1, y_min, z1)),
        bm.verts.new((x2, y_min, z2)),
        bm.verts.new((x2, y_max, z2)),
        bm.verts.new((x1, y_max, z1)),
    ]
    bm.faces.new(verts)
    return bm


def _flat_panel(points_xz):
    """X-Z 平面の多角形を1枚の面にする（側面に貼る板）。"""
    bm = bmesh.new()
    for x, z in points_xz:
        bm.verts.new((x, 0.0, z))
    bm.verts.ensure_lookup_table()
    bm.faces.new(bm.verts)
    return bm


def _box(size, center=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, verts=bm.verts, vec=Vector(size))
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(center))
    return bm


def _cylinder(segments, radius, depth, center=(0, 0, 0)):
    """Y 軸まわりの円柱（車輪・フェンダーの刃）。"""
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius, radius2=radius, depth=depth,
    )
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(1.5707963, 3, "X"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(center))
    return bm


def _outward_offset(p1, p2, amount=SURFACE_OFFSET):
    """区間 p1→p2 の外向き（車体中心から離れる向き）へずらした2点を返す。

    ★「x が正なら外」ではない。後ろ側の面は -X が外。中心から離れる向きで判定する。
    """
    a = Vector((p1[0], 0.0, p1[1]))
    b = Vector((p2[0], 0.0, p2[1]))
    edge = (b - a).normalized()
    normal = Vector((edge.z, 0.0, -edge.x))
    center = Vector((0.0, 0.0, (BODY_BOTTOM + ROOF) / 2))
    if normal.dot((a + b) / 2 - center) < 0:
        normal = -normal
    shift = normal * amount
    return (a + shift), (b + shift), edge


# ── 車体 ────────────────────────────────────────────────────────────────


def part_body():
    """側面シルエットを押し出し、中央ループで丸みを付け、フェンダーをくり抜く。"""
    bm = bmesh.new()
    verts = [bm.verts.new((x, -HALF_W, z)) for x, z in SIDE_PROFILE]
    bm.faces.new(verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ret = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
    moved = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, WIDTH, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    # 幅方向の辺を割って中央ループを作る。ルーフに山なりを付けるため
    span_edges = [e for e in bm.edges if abs(e.verts[0].co.y - e.verts[1].co.y) > WIDTH * 0.5]
    bmesh.ops.subdivide_edges(bm, edges=span_edges, cuts=1, use_grid_fill=False)
    bm.verts.ensure_lookup_table()

    for v in bm.verts:
        if abs(v.co.y) < 0.01:  # 中央ループ
            if v.co.z > ROOF - 0.05:
                v.co.z += 0.022  # ルーフの山なり
        else:
            # ★絞りは「窓より上」だけに留める。側面の窓が乗る帯を垂直に保たないと、
            #   平板の窓がめり込む。裾は軽く絞って腰高に見せない。
            if v.co.z > ROOF - 0.10:
                v.co.y *= 0.94
            elif v.co.z < BODY_BOTTOM + 0.10:
                v.co.y *= 0.95

    mesh = _mesh_from_bmesh("keivan_body", bm, "body")
    obj = bpy.data.objects.new("body", mesh)
    bpy.context.scene.collection.objects.link(obj)

    # フェンダー（ホイールアーチ）を左右それぞれの側面からくり抜く。
    # ★左右を貫通させると前から見て隙間が抜けて見える。片側ずつ浅く彫る
    cutters = []
    for label, x in (("front", AXLE_FRONT_X), ("rear", AXLE_REAR_X)):
        for sign, side in ((1, "l"), (-1, "r")):
            cm = _cylinder(20, ARCH_RADIUS, 0.42, center=(x, sign * (HALF_W - 0.03), AXLE_Z))
            cutter_mesh = bpy.data.meshes.new(f"__arch_{label}_{side}")
            cm.to_mesh(cutter_mesh)
            cm.free()
            cutter = bpy.data.objects.new(f"__arch_{label}_{side}", cutter_mesh)
            bpy.context.scene.collection.objects.link(cutter)
            cutter.display_type = "WIRE"
            cutter.hide_render = True
            cutters.append(cutter)
            mod = obj.modifiers.new(f"arch_{label}_{side}", "BOOLEAN")
            mod.operation = "DIFFERENCE"
            mod.object = cutter
            mod.solver = "EXACT"

    bevel = obj.modifiers.new("bevel", "BEVEL")
    bevel.width = 0.045
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = 0.52  # 30度。フェンダーの丸みは削らない
    return [obj], cutters


# ── ガラス ──────────────────────────────────────────────────────────────


def part_glass():
    objects = []

    # フロントガラスは A ピラーの曲線に沿わせる（1枚の平板だと車体を突き抜ける）。
    # ルーフへの立ち上がり区間は車体色なので、ガラスは WS_TOP〜WS_BASE だけ
    for i, (p1, p2) in enumerate(((P_WS_TOP, P_WS_MID), (P_WS_MID, P_WS_BASE))):
        a, b, edge = _outward_offset(p1, p2)
        head = edge * (0.05 if i == 0 else 0.0)
        tail = edge * (0.05 if i == 1 else 0.0)
        bm = _quad(
            [((a + head).x, (a + head).z), ((b - tail).x, (b - tail).z)],
            -HALF_W * 0.85, HALF_W * 0.85,
        )
        objects.append(
            _instance(f"windshield_{i}", _mesh_from_bmesh(f"keivan_windshield_{i}", bm, "glass"))
        )

    a, b, edge = _outward_offset(P_REAR_TOP, (-HALF_L, ROOF - 0.70))
    inset = edge * 0.02
    bm = _quad(
        [((a + inset).x, (a + inset).z), ((b - inset).x, (b - inset).z)],
        -HALF_W * 0.82, HALF_W * 0.82,
    )
    objects.append(_instance("rear_window", _mesh_from_bmesh("keivan_rear_window", bm, "glass")))

    # 側面は3枚（運転席ドア / スライドドア / クォーター）。実車の分割に合わせる
    panes = {
        # ★前端は A ピラー（フロントガラスの傾き）に沿わせる。越えると
        #   窓が車体からはみ出した黒い舌のように飛び出す
        "door_front": [
            (P_WS_TOP[0] + 0.11, BELT_TOP),
            (P_WS_BASE[0] - 0.06, BELT_BOTTOM),
            (DOOR_FRONT_REAR_EDGE + 0.03, BELT_BOTTOM),
            (DOOR_FRONT_REAR_EDGE + 0.03, BELT_TOP),
        ],
        "door_slide": [
            (DOOR_FRONT_REAR_EDGE - 0.03, BELT_TOP),
            (DOOR_FRONT_REAR_EDGE - 0.03, BELT_BOTTOM),
            (SLIDE_DOOR_REAR_EDGE + 0.03, BELT_BOTTOM),
            (SLIDE_DOOR_REAR_EDGE + 0.03, BELT_TOP),
        ],
        "quarter": [
            (SLIDE_DOOR_REAR_EDGE - 0.03, BELT_TOP),
            (SLIDE_DOOR_REAR_EDGE - 0.03, BELT_BOTTOM),
            (-HALF_L + 0.14, BELT_BOTTOM),
            (-HALF_L + 0.14, BELT_TOP),
        ],
    }
    for label, pts in panes.items():
        mesh = _mesh_from_bmesh(f"keivan_glass_{label}", _flat_panel(pts), "glass")
        for sign, side in ((1, "l"), (-1, "r")):
            objects.append(
                _instance(
                    f"side_window_{label}_{side}", mesh,
                    location=(0, sign * (HALF_W + SURFACE_OFFSET), 0),
                    scale=(1, sign, 1),
                )
            )
    return objects


# ── フロント / リアまわり ──────────────────────────────────────────────


def part_front_face():
    """グリル（横スリット3本）・ヘッドライト・下部インテーク。"""
    objects = []
    a, _b, _ = _outward_offset(P_FACE_TOP, P_FACE_LOW)
    face_x = a.x
    top = P_FACE_TOP[1]

    # グリル: 横スリットを3本入れて「面」ではなく「格子」に見せる
    slit_h = 0.035
    for i in range(3):
        z = top - 0.10 - i * 0.062
        bm = _quad([(face_x, z), (face_x, z - slit_h)], -HALF_W * 0.34, HALF_W * 0.34)
        objects.append(
            _instance(f"front_grille_{i}", _mesh_from_bmesh(f"keivan_grille_{i}", bm, "trim"))
        )

    # ヘッドライト: グリルの左右。内側を細く、外側を太くして台形に見せる
    bm = bmesh.new()
    for (z, y) in (
        (top - 0.07, HALF_W * 0.38),
        (top - 0.22, HALF_W * 0.38),
        (top - 0.26, HALF_W * 0.86),
        (top - 0.09, HALF_W * 0.86),
    ):
        bm.verts.new((face_x, y, z))
    bm.verts.ensure_lookup_table()
    bm.faces.new(bm.verts)
    mesh = _mesh_from_bmesh("keivan_headlight", bm, "light")
    objects.append(_instance("headlight_l", mesh))
    objects.append(_instance("headlight_r", mesh, scale=(1, -1, 1)))

    # バンパー下部のインテーク（黒い横長の口）
    bm = _quad(
        [(face_x, BODY_BOTTOM + 0.44), (face_x, BODY_BOTTOM + 0.32)],
        -HALF_W * 0.55, HALF_W * 0.55,
    )
    objects.append(
        _instance("front_intake", _mesh_from_bmesh("keivan_front_intake", bm, "trim"))
    )
    return objects


def part_taillight():
    """テールランプ。リアの左右に縦長で。"""
    x = -HALF_L - SURFACE_OFFSET
    bm = _quad([(x, ROOF - 0.76), (x, ROOF - 1.14)], HALF_W * 0.56, HALF_W * 0.85)
    mesh = _mesh_from_bmesh("keivan_taillight", bm, "taillight")
    return [
        _instance("taillight_l", mesh),
        _instance("taillight_r", mesh, scale=(1, -1, 1)),
    ]


# ── 側面のディテール ────────────────────────────────────────────────────


def part_door_details():
    """ドアの分割線とハンドル。細い板を貼るだけだが、側面の情報量が変わる。"""
    objects = []
    gap = 0.012
    line_pts = [
        (0.0, BELT_BOTTOM - 0.02),
        (0.0, BODY_BOTTOM + 0.16),
        (gap, BODY_BOTTOM + 0.16),
        (gap, BELT_BOTTOM - 0.02),
    ]
    line_mesh = _mesh_from_bmesh("keivan_door_line", _flat_panel(line_pts), "trim")
    for label, x in (("front", DOOR_FRONT_REAR_EDGE), ("slide", SLIDE_DOOR_REAR_EDGE)):
        for sign, side in ((1, "l"), (-1, "r")):
            objects.append(
                _instance(
                    f"door_line_{label}_{side}", line_mesh,
                    location=(x, sign * (HALF_W + SURFACE_OFFSET), 0),
                    scale=(1, sign, 1),
                )
            )

    handle_pts = [
        (0.0, BELT_BOTTOM - 0.10),
        (0.0, BELT_BOTTOM - 0.15),
        (0.16, BELT_BOTTOM - 0.15),
        (0.16, BELT_BOTTOM - 0.10),
    ]
    handle_mesh = _mesh_from_bmesh("keivan_door_handle", _flat_panel(handle_pts), "trim")
    for label, x in (
        ("front", DOOR_FRONT_REAR_EDGE - 0.22),
        ("slide", SLIDE_DOOR_REAR_EDGE + 0.06),
    ):
        for sign, side in ((1, "l"), (-1, "r")):
            objects.append(
                _instance(
                    f"door_handle_{label}_{side}", handle_mesh,
                    location=(x, sign * (HALF_W + SURFACE_OFFSET * 1.6), 0),
                    scale=(1, sign, 1),
                )
            )
    return objects


# ── 足まわり・その他 ────────────────────────────────────────────────────


def part_wheel():
    """タイヤ＋リム。**4個が同じメッシュを共有**する。"""
    tire_mesh = _mesh_from_bmesh("keivan_wheel_tire", _cylinder(18, WHEEL_RADIUS, WHEEL_WIDTH), "tire")
    rim_mesh = _mesh_from_bmesh("keivan_wheel_rim", _cylinder(14, RIM_RADIUS, WHEEL_WIDTH * 0.7), "rim")

    tread = HALF_W - WHEEL_WIDTH / 2 + 0.005
    objects = []
    for label, x in (("front", AXLE_FRONT_X), ("rear", AXLE_REAR_X)):
        for sign, side in ((1, "l"), (-1, "r")):
            y = sign * tread
            objects.append(_instance(f"wheel_{label}_{side}", tire_mesh, location=(x, y, AXLE_Z)))
            # リムはタイヤより外へ少し出す（外から見て銀色が見えるように）
            objects.append(
                _instance(f"wheel_rim_{label}_{side}", rim_mesh, location=(x, y + sign * 0.026, AXLE_Z))
            )
    return objects


def part_bumper():
    """前後バンパー。薄い箱にして側面から見ても厚みが出るようにする。"""
    depth = 0.11
    mesh = _mesh_from_bmesh("keivan_bumper", _box((depth, WIDTH * 0.99, 0.19)), "trim")
    return [
        _instance("bumper_front", mesh, location=(HALF_L - depth / 2 + 0.03, 0, BODY_BOTTOM + 0.14)),
        _instance("bumper_rear", mesh, location=(-HALF_L + depth / 2 - 0.03, 0, BODY_BOTTOM + 0.14)),
    ]


def part_mirror():
    """ドアミラー（鏡面部＋ステー）。2個でメッシュ共有。"""
    bm = _box((0.055, 0.10, 0.10), center=(0, 0.075, 0.0))
    stay = _box((0.028, 0.075, 0.028), center=(0, 0.015, -0.025))
    # 2つの箱を1つの bmesh にまとめる
    tmp_mesh = bpy.data.meshes.new("__stay_tmp")
    stay.to_mesh(tmp_mesh)
    stay.free()
    bm.from_mesh(tmp_mesh)
    bpy.data.meshes.remove(tmp_mesh)

    mesh = _mesh_from_bmesh("keivan_mirror", bm, "trim")
    x = P_WS_BASE[0] - 0.16
    z = BELT_BOTTOM - 0.02
    return [
        _instance("mirror_l", mesh, location=(x, HALF_W + 0.01, z)),
        _instance("mirror_r", mesh, location=(x, -(HALF_W + 0.01), z), scale=(1, -1, 1)),
    ]


def part_plate():
    """ナンバープレート。前後2枚でメッシュ共有。

    ★プレートを独立したマテリアルで持つのが要点。整形パイプラインの
      「幾何条件での自動切り出し」はバンパーに黒い破片が出るので使わない
      （2026-08-11 実測。prepare-vehicle-glb.mjs には plateMode=none を渡す）。
    """
    plate_w, plate_h = 0.33, 0.165  # 軽自動車の標準サイズ
    bm = _quad([(0.0, plate_h / 2), (0.0, -plate_h / 2)], -plate_w / 2, plate_w / 2)
    mesh = _mesh_from_bmesh("keivan_plate", bm, "plate")
    z = BODY_BOTTOM + 0.14
    return [
        _instance("plate_front", mesh, location=(HALF_L + 0.10, 0, z)),
        _instance("plate_rear", mesh, location=(-(HALF_L + 0.10), 0, z), rotation=(0, 0, 3.14159265)),
    ]


PARTS = (
    part_glass,
    part_front_face,
    part_taillight,
    part_door_details,
    part_wheel,
    part_bumper,
    part_mirror,
    part_plate,
)


# ── 書き出し前の結合 ────────────────────────────────────────────────────


def join_by_material():
    """マテリアル単位でメッシュを結合する（書き出し用）。

    部品ごとに別メッシュのまま出すと glTF の primitive が増え、地図に数十台
    載せたときのドローコールがそのまま増える。形はそのまま、束ね方だけ変える。
    ★リンク複製（共有メッシュ）は結合前に実体化しないと、1個分しか残らない。
    ★"__" で始まるオブジェクト（ブーリアンの刃）は書き出さないので除外する。
    """
    targets = [
        o for o in bpy.context.scene.objects
        if o.type == "MESH" and not o.name.startswith("__")
    ]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in targets:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.convert(target="MESH")  # ブーリアン・ベベルを確定させる

    groups = {}
    for obj in [
        o for o in bpy.context.scene.objects
        if o.type == "MESH" and not o.name.startswith("__")
    ]:
        key = obj.data.materials[0].name if obj.data.materials else "none"
        groups.setdefault(key, []).append(obj)

    merged = []
    for key, objs in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        joined.name = key.replace("keivan_", "")
        merged.append(joined)

    # 刃はもう要らないので消す（書き出しに混ぜない）
    for o in [x for x in bpy.context.scene.objects if x.name.startswith("__")]:
        bpy.data.objects.remove(o, do_unlink=True)

    # ★親子付けと変換を全部焼き込んで、各ノードを単位行列にする。
    #   仕上げの prepare-vehicle-glb.mjs は POSITION アクセサだけを見て寸法を測り、
    #   頂点を直接書き換える（ノード変換を見ない）。ノードに位置が残っていると
    #   「寸法を誤る」「部品が散る」の両方が起きる（2026-08-18 実測）。
    bpy.ops.object.select_all(action="DESELECT")
    for o in merged:
        o.select_set(True)
    bpy.context.view_layer.objects.active = merged[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return merged


def build():
    _clear_scene()

    root = bpy.data.objects.new("KeiVan", None)  # 部品をぶら下げる親
    root.empty_display_size = 0.4
    bpy.context.scene.collection.objects.link(root)

    body_objs, cutters = part_body()
    parts = list(body_objs)
    for factory in PARTS:
        parts.extend(factory())

    for obj in parts:
        obj.parent = root
    for cutter in cutters:  # ブーリアンの刃も一緒に回す（車体との位置関係を保つ）
        cutter.parent = root

    # 前を -Y へ向ける（Blender の Front ビューが車の正面になる）
    root.rotation_euler = (0, 0, -1.5707963267948966)

    bpy.context.view_layer.objects.active = root
    return root, parts


root, parts = build()
result = f"KeiVan: {len(parts)} objects / {len({p.data.name for p in parts})} meshes"
print(result)
