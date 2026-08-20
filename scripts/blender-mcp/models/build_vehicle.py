"""
生成モデル（Meshy）から、地図・資料に使う車両モデルを起こす通しパイプライン。

## 考え方（2026-08-20 の試行錯誤の結論）

**Decimate Collapse は使わない。** 誤差が小さい順に潰すので、平らなパネルに三角形を残し、
ドア境界・窓枠・アーチの稜線を丸める。つまり**予算を平面に使い、稜線を削る**。
求めているのは逆（車種識別に効くのは稜線）。

代わりに次の3段構えにする:

1. **平滑化**でスキャン由来のノイズを消す。
   ★これが要る。ノイズは「隣り合う面の角度が大きい」ので、平面統合が
   **ノイズを稜線と誤認して守り**、代わりに本物の緩い稜線（リアガラス等）を削る
2. **平面統合（Planar / DISSOLVE）**で平面を大胆に潰す。稜線は角度で守られる
3. **車輪を作り直す**。スキャンのハブはボルト穴・リング・ノイズで数千三角形を食うが、
   車種識別には**何も寄与しない**。円柱に置き換えると劇的に軽くなる

## 使い方

    { echo 'SOURCE_GLB = "/path/to/meshy.glb"'
      echo 'OUT_DIR = "/path/to/out"'
      echo 'NAME = "acty"'
      cat scripts/blender-mcp/models/build_vehicle.py; } \
      | python3 scripts/blender-mcp/bridge.py exec -
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

# ── 入出力（呼び出し側で上書きする） ────────────────────────────────
SOURCE_GLB = globals().get("SOURCE_GLB", "")
OUT_DIR = globals().get("OUT_DIR", os.path.expanduser("~/Developer/assets/hakotora-3d/out"))
NAME = globals().get("NAME", "vehicle")

# ── 実車の寸法（軽自動車規格） ───────────────────────────────────────
LENGTH = globals().get("LENGTH", 3.395)
WIDTH = globals().get("WIDTH", 1.475)

# ── 減面の強さ ───────────────────────────────────────────────────────
# 下ごしらえ。★Collapse ではなく浅い角度の溶解を使う（Collapse は形を歪める）
PRE_DISSOLVE_ANGLE = globals().get("PRE_DISSOLVE_ANGLE", 1.5)
PRE_COLLAPSE = globals().get("PRE_COLLAPSE", 1.0)   # 1.0 = 使わない（保険）
SMOOTH_ITER = globals().get("SMOOTH_ITER", 0)   # 0＝平滑化しない（既定）
SMOOTH_FACTOR = globals().get("SMOOTH_FACTOR", 0.6)
# 本番の平面統合。30度が詳細ページ用の確定値（2026-08-20）
PLANAR_ANGLE = globals().get("PLANAR_ANGLE", 30.0)
# 平滑化から守る稜線の角度。ノイズ（およそ10〜40度）より上、
# 本物の段差（窓枠・ドア境界＝60度以上）より下に置く
# 稜線の候補として拾う角度。ノイズも入るが、後段で鎖の長さで選別する
ANGLE_CANDIDATE = globals().get("ANGLE_CANDIDATE", 17.0)
# 繋がった鎖の総延長がこれ未満なら「ノイズ」として捨てる（単位: m）
MIN_CHAIN_LENGTH = globals().get("MIN_CHAIN_LENGTH", 0.35)

# ── 車輪 ─────────────────────────────────────────────────────────────
TIRE_SEGMENTS = globals().get("TIRE_SEGMENTS", 20)
# 原本の車輪が十分きれいな場合は False にして、その造形を保持する。
# Meshy由来のノイズが多い車輪だけを簡易円柱へ差し替える。
REBUILD_WHEELS = globals().get("REBUILD_WHEELS", True)
# ★半径は実測しない。タイヤと車体側面が縦に繋がっていて境目が見つからず、
#   どう工夫しても破綻する（2026-08-20）。軽自動車の実値を使うほうが確実で正しい。
#   軸の前後位置とトレッド幅は接地点から正確に取れるので、そちらは実測を使う。
WHEEL_RADIUS = globals().get("WHEEL_RADIUS", 0.295)
RIM_RATIO = 0.58          # タイヤ半径に対するリムの比
WHEEL_CUT_MARGIN = 1.06   # 検出半径のこの倍まで削る


def _apply_transform(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def _bounds(obj):
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for c in obj.bound_box:
        w = obj.matrix_world @ Vector(c)
        for i in range(3):
            lo[i] = min(lo[i], w[i])
            hi[i] = max(hi[i], w[i])
    return lo, hi


def import_and_normalize():
    """実寸・原点=底面中心・**前を -Y**（長さ=Y / 幅=X）に揃える。"""
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SOURCE_GLB)
    obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    obj.name = NAME

    # ★法線を揃える。生成モデルには裏返った面があり、後ろから見ると片側が真っ黒に落ちる。
    #   それだけでなく、**稜線検出も平面統合も面の法線から角度を計算している**ので、
    #   法線が不揃いだと角度の判定そのものが嘘になる（2026-08-20）。
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    flipped_before = sum(1 for f in bm.faces if f.normal.length == 0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    print(f"  法線を再計算（面 {len(obj.data.polygons):,} 枚）")

    lo, hi = _bounds(obj)
    size = hi - lo
    # 長い水平軸を「前後」とみなす
    long_axis = "X" if size.x >= size.y else "Y"
    print(f"  取り込み時の寸法 {[round(v,3) for v in size]} / 長手軸={long_axis}")
    scale = LENGTH / max(size.x, size.y)

    # 幅は車種ごとに太り方が違うので実測して詰める（中央付近の断面で測る）
    mid = (lo + hi) / 2
    cross = "Y" if long_axis == "X" else "X"
    vals = []
    for v in obj.data.vertices:
        w = obj.matrix_world @ v.co
        along = w.x if long_axis == "X" else w.y
        if abs(along - (mid.x if long_axis == "X" else mid.y)) > size.length * 0.05:
            continue
        if not (lo.z + size.z * 0.3 < w.z < lo.z + size.z * 0.65):
            continue
        vals.append(w.y if cross == "Y" else w.x)
    measured = (max(vals) - min(vals)) * scale if vals else WIDTH
    width_fix = WIDTH / measured if measured > 0 else 1.0

    # ★glTF インポータはオブジェクトの回転モードを QUATERNION にする。そのままだと
    #   `rotation_euler` への代入は**黙って無視される**（2026-08-20 実測。向きが
    #   揃わず車輪の検出軸まで狂っていた）。必ずモードを切り替えてから設定する。
    obj.rotation_mode = "XYZ"
    if long_axis == "X":
        obj.scale = (scale, scale * width_fix, scale)
        obj.rotation_euler = (0, 0, math.radians(90))  # 前(-X) → -Y
    else:
        obj.scale = (scale * width_fix, scale, scale)
    bpy.context.view_layer.update()
    _apply_transform(obj)
    lo, hi = _bounds(obj)
    print(f"  変換適用後の寸法 {[round(v,3) for v in (hi - lo)]}")

    center = (lo + hi) / 2
    obj.location = (-center.x, -center.y, -lo.z)
    _apply_transform(obj)
    print(f"正規化: 実測幅 {measured:.3f}m -> {WIDTH}m / 寸法 {[round(v,3) for v in obj.dimensions]}")
    return obj


def pre_dissolve(obj):
    """下ごしらえも**限定的溶解**で行う。

    ★ここに Collapse を使っていたのが、車体がボコボコになる原因だった
      （2026-08-20 ユーザー指摘）。Collapse は誤差が小さい順に頂点を潰すので、
      平らな面ほど先に削られて歪む。ごく浅い角度（既定 1.5度）の溶解なら
      **形をほぼ変えずに**平面上の無駄な面だけを落とせる。
    """
    m = obj.modifiers.new("pre_planar", "DECIMATE")
    m.decimate_type = "DISSOLVE"
    m.angle_limit = math.radians(PRE_DISSOLVE_ANGLE)
    m.delimit = {"MATERIAL"}   # 分類は済んでいるので塗り分けの境界を守れる
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)
    print(f"  下ごしらえ（{PRE_DISSOLVE_ANGLE}度の溶解）: {len(obj.data.polygons):,} 面")
    return obj


def smooth_material_boundaries(obj):
    """塗り分けの境界を、隣接面の多数決で均す。

    ★テクスチャの閾値でそのまま切ると、窓の縁が**1面単位でギザギザ**になり、
      窓が割れて見える（2026-08-20 ユーザー指摘）。さらに境界が細かいと
      平面統合が `delimit={MATERIAL}` で止まり、**面数が落ちない**という副作用もある。
      隣接面の多数決を数回まわすと、縁が滑らかになり島も減る。
    """
    if BOUNDARY_SMOOTH_PASSES <= 0:
        return obj
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    changed_total = 0
    for _ in range(BOUNDARY_SMOOTH_PASSES):
        pending = []
        for f in bm.faces:
            counts = {}
            for e in f.edges:
                for nf in e.link_faces:
                    if nf is not f:
                        counts[nf.material_index] = counts.get(nf.material_index, 0) + 1
            if not counts:
                continue
            best, n = max(counts.items(), key=lambda kv: kv[1])
            # 自分と同じ色の隣より、別の色の隣のほうが多いときだけ乗り換える
            if best != f.material_index and n >= 2 and counts.get(f.material_index, 0) < n:
                pending.append((f, best))
        for f, m in pending:
            f.material_index = m
        changed_total += len(pending)
        if not pending:
            break
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    print(f"  塗り分けの境界を均した: {changed_total:,} 面が乗り換え")
    return obj


def pre_collapse(obj):
    """目標面数に届かないときだけ使う保険（既定は無効）。"""
    if PRE_COLLAPSE >= 1.0:
        return obj
    m = obj.modifiers.new("pre", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = PRE_COLLAPSE
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)
    return obj


# ── テクスチャ色による塗り分け ───────────────────────────────────────
# Meshy の生成モデルは**テクスチャに塗り分けが焼かれている**（白い車体・暗い窓・
# 赤いテール・黄のウインカー/ナンバー）。マテリアルは1つしか無いが、面の UV で
# ベースカラーを引けば部位が分かる。2026-08-20 に実測で確認した閾値。
#
# ★この工程は**減面より前**に置くこと。減面後のメッシュは面が繋がっておらず
#   （辺の 5〜6 割が境界）、Blender の「平坦な面を選択」も連結成分も使えない。
CLASS_COLORS = {
    "body": (0.92, 0.92, 0.93, 1),    # 白い外板。★地図ではここに model-color が乗る
    "glass": (0.13, 0.14, 0.17, 1),   # 窓ガラス
    "black": (0.06, 0.06, 0.07, 1),   # 窓枠・グリル・バンパー下・モール
    "red": (0.65, 0.05, 0.05, 1),     # テールランプ
    "amber": (0.90, 0.55, 0.05, 1),   # ウインカー・ナンバー
}
# 着色したくない部位（地図で2レイヤーに割るとき fixed 側へ回す）
UNTINTED = ("glass", "black", "red", "amber")
# 分類前にテクスチャを何分の1へ縮小するか（汚しの細線を潰すため。1 で無効）
CLASSIFY_DOWNSAMPLE = globals().get("CLASSIFY_DOWNSAMPLE", 16)
# 車体へ倒す部位。★地図用は ("black",) を指定する。
#   black（窓枠・グリル・モール）は粗く減面すると**車体に細い黒い傷として散る**
#   （2026-08-20 実測。マテリアル別に着色して犯人を特定した）。地図の 200px では
#   グリルもモールも見えないので、車体色に倒したほうがきれいに出る。
#   窓の輪郭は glass 自身が担うので、枠が消えても形は保たれる。
MERGE_INTO_BODY = globals().get("MERGE_INTO_BODY", ())
# 書き出し前の仕上げ。頂点の溶接距離と、法線を共有する角度
WELD_DISTANCE = globals().get("WELD_DISTANCE", 0.0015)
SHADE_SMOOTH_ANGLE = globals().get("SHADE_SMOOTH_ANGLE", 32.0)
# これ未満の面積（m2）の塗り分けの島は車体色に倒す。0 で無効
SPECK_MAX_AREA = globals().get("SPECK_MAX_AREA", 0.012)
# 詳細ページ用の1枚（{NAME}_raw.glb）に Draco 圧縮を掛けるか。地図用の分割ファイルには掛けない
DRACO = globals().get("DRACO", False)
# 詳細表示で原本テクスチャの輪郭を残したい場合は False にする。
# 面単位の分類は地図の model-color には必要だが、低ポリ詳細モデルでは窓の境界が
# ギザギザになる。形状の減面と見た目の塗り分けを分離するための切り替え。
CLASSIFY_MATERIALS = globals().get("CLASSIFY_MATERIALS", True)
# CLASSIFY_MATERIALS=False のとき、原本テクスチャをこの長辺pxまで縮小する。0で原寸。
TEXTURE_MAX_SIZE = globals().get("TEXTURE_MAX_SIZE", 0)
# 塗り分けの境界を隣接面の多数決で均す回数（窓の縁のギザギザ対策）
BOUNDARY_SMOOTH_PASSES = globals().get("BOUNDARY_SMOOTH_PASSES", 4)
# 外から見えない面を削るときのレイ本数。
# ★既定は 0（無効）。生成モデルは**法線が一部反転している**ためレイの起点が面の内側に
#   入り、見えている車体まで削って**大穴が開く**（2026-08-20 実測）。削減も 2,466 枚と
#   小さく、サイズは Draco（4.02MB → 0.69MB）で足りるので使わない。
HIDDEN_CULL_RAYS = globals().get("HIDDEN_CULL_RAYS", 0)


def _base_color_image(obj):
    for mat in obj.data.materials:
        if not mat or not mat.node_tree:
            continue
        for n in mat.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                return n.image
    return None


def classify_by_texture(obj):
    """面ごとに UV でテクスチャ色を引き、部位別のマテリアルへ振り分ける。

    テクスチャが無いモデル（旧 generate 版）では何もしない。
    """
    me = obj.data
    img = _base_color_image(obj)
    if img is None or not me.uv_layers:
        print("  テクスチャ or UV が無いので塗り分けは省略")
        return None

    import numpy as np

    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    px = buf.reshape(h, w, 4)[:, :, :3]

    # ★テクスチャには「汚し・陰影の細い暗線」が焼かれていて、そのままサンプルすると
    #   車体に黒い引っかき傷が散る（2026-08-20 実測）。ブロック平均で縮小してから
    #   サンプルすると、細い線は周りの白に薄まって車体へ倒れ、窓のような広い暗部だけが残る。
    #   窓枠の黒も一緒に消えるが、ガラス面が残るので輪郭は保たれる。
    if CLASSIFY_DOWNSAMPLE > 1:
        d = CLASSIFY_DOWNSAMPLE
        h2, w2 = h // d, w // d
        px = px[: h2 * d, : w2 * d].reshape(h2, d, w2, d, 3).mean(axis=(1, 3))
        h, w = h2, w2
        print(f"  分類用にテクスチャを 1/{d} へ縮小（{w}x{h}）")

    n = len(me.polygons)
    loop_total = np.empty(n, dtype=np.int32)
    loop_start = np.empty(n, dtype=np.int32)
    me.polygons.foreach_get("loop_total", loop_total)
    me.polygons.foreach_get("loop_start", loop_start)
    uvs = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uvs)
    uvs = uvs.reshape(-1, 2)
    # 面ごとの UV 重心（ループは面ごとに連続して並んでいる）
    centers = np.add.reduceat(uvs, loop_start, axis=0) / loop_total[:, None]

    xi = np.clip((centers[:, 0] * w).astype(np.int32), 0, w - 1)
    yi = np.clip((centers[:, 1] * h).astype(np.int32), 0, h - 1)
    lin = np.clip(px[yi, xi], 0.0, 1.0)
    # Blender の pixels はリニア。閾値は目で見た色（sRGB）で決めてあるので変換する
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)

    mx = srgb.max(axis=1)
    mn = srgb.min(axis=1)
    V = mx
    S = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    d = np.maximum(mx - mn, 1e-6)
    r, g, b = srgb[:, 0], srgb[:, 1], srgb[:, 2]
    H = np.where(
        mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)
    ) / 6.0
    H = np.where(mn == mx, 0.0, H)

    # ★閾値は 2026-08-20 に色分けレンダリングで目視確認した値
    cat = np.full(n, 0, dtype=np.int32)  # 既定は body
    names = list(CLASS_COLORS)
    idx = {k: i for i, k in enumerate(names)}
    colored = S > 0.35
    cat[(V >= 0.30) & (V < 0.58) & (S < 0.30)] = idx["glass"]
    cat[V < 0.30] = idx["black"]
    cat[colored & (V > 0.35) & (H >= 0.05) & (H < 0.19)] = idx["amber"]
    cat[colored & (V > 0.30) & ((H < 0.05) | (H > 0.95))] = idx["red"]
    for key in MERGE_INTO_BODY:
        cat[cat == idx[key]] = idx["body"]

    me.materials.clear()
    for name in names:
        mat = bpy.data.materials.new(f"{NAME}_{name}")
        mat.use_nodes = True
        bsdf = next(nd for nd in mat.node_tree.nodes if nd.type == "BSDF_PRINCIPLED")
        col = CLASS_COLORS[name]
        # ★ノードは type、ソケットは identifier で引く。UI 言語が日本語だと
        #   名前が翻訳されていて、名前で引くと黙って無視される（2026-08-20）
        next(s for s in bsdf.inputs if s.identifier == "Base Color").default_value = col
        next(s for s in bsdf.inputs if s.identifier == "Roughness").default_value = (
            0.25 if name == "glass" else 0.6
        )
        mat.diffuse_color = col
        me.materials.append(mat)
    me.polygons.foreach_set("material_index", cat)
    me.update()

    counts = {names[i]: int((cat == i).sum()) for i in range(len(names))}
    print(f"  テクスチャ色で塗り分け: {counts}")
    return counts


def resize_source_textures(obj):
    """原本の見た目を保ったまま、詳細表示用テクスチャの転送量を抑える。"""
    if TEXTURE_MAX_SIZE <= 0:
        return
    seen = set()
    for mat in obj.data.materials:
        if not mat or not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.type != "TEX_IMAGE" or not node.image or node.image.name in seen:
                continue
            image = node.image
            seen.add(image.name)
            width, height = image.size
            longest = max(width, height)
            if longest <= TEXTURE_MAX_SIZE:
                continue
            scale = TEXTURE_MAX_SIZE / longest
            target = (max(1, round(width * scale)), max(1, round(height * scale)))
            image.scale(*target)
            print(f"  テクスチャ縮小: {width}x{height} → {target[0]}x{target[1]}")


def detect_wheels(obj):
    """車輪の位置と半径を実測する。幅=X / 前後=Y。

    ★「低い位置で外側」だけで拾うと**車体側面まで含まれて半径が破綻する**
      （2026-08-20 実測で 0.85m になった）。接地点＝タイヤの底から入るのが確実。
    """
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    half_w = max(abs(p.x) for p in pts)
    ground = [p for p in pts if p.z < 0.10 and abs(p.x) > half_w * 0.45]
    if not ground:
        return []
    ys = sorted(p.y for p in ground)
    mid_y = (ys[0] + ys[-1]) / 2
    wheels = []
    for label, g in (("front", [p for p in ground if p.y < mid_y]),
                     ("rear", [p for p in ground if p.y >= mid_y])):
        if not g:
            continue
        cy = sum(p.y for p in g) / len(g)
        tread_in = min(abs(p.x) for p in g)
        tread_out = max(abs(p.x) for p in g)
        r = WHEEL_RADIUS
        wheels.append({"label": label, "y": cy, "z": r, "r": r,
                       "x_out": tread_out, "x_in": tread_in})
        print(f"  車輪({label}): y={cy:.3f} 半径={r:.3f} トレッド|x| {tread_in:.3f}〜{tread_out:.3f}")
    return wheels


def remove_wheel_geometry(obj, wheels):
    """車輪まわりの面を削る。**アーチ（車体側）は半径の外なので残る**。"""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    half_w = max(abs(v.co.x) for v in bm.verts)
    doomed = []
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(c.x) < half_w * 0.42:
            continue
        for w in wheels:
            if math.hypot(c.y - w["y"], c.z - w["z"]) <= w["r"] * WHEEL_CUT_MARGIN:
                doomed.append(f)
                break
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    print(f"  車輪の面を {len(doomed)} 枚削除")
    return obj


def build_clean_wheels(wheels, half_width):
    """円柱のタイヤ＋リムを作る。**4輪でメッシュを共有**する。"""
    if not wheels:
        return []
    r = WHEEL_RADIUS
    tread = sum(w["x_out"] for w in wheels) / len(wheels)
    inner = sum(w["x_in"] for w in wheels) / len(wheels)
    depth = max(0.11, (tread - inner) * 1.05)

    def cylinder(name, radius, dep, mat_color):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False,
                              segments=TIRE_SEGMENTS, radius1=radius, radius2=radius, depth=dep)
        # 既定は Z 軸まわり。幅方向(X)へ倒す
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                         matrix=Matrix.Rotation(math.radians(90), 3, "Y"))
        mesh = bpy.data.meshes.new(name)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(mesh)
        bm.free()
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        next(s for s in bsdf.inputs if s.identifier == "Base Color").default_value = mat_color
        mat.diffuse_color = mat_color
        mesh.materials.append(mat)
        return mesh

    tire_mesh = cylinder(f"{NAME}_tire", r, depth, (0.05, 0.05, 0.06, 1))
    rim_mesh = cylinder(f"{NAME}_rim", r * RIM_RATIO, depth * 0.92, (0.72, 0.73, 0.75, 1))

    objs = []
    for w in wheels:
        for sign in (1, -1):
            x = sign * (tread - depth / 2)
            for tag, mesh, dx in (("tire", tire_mesh, 0.0), ("rim", rim_mesh, sign * 0.012)):
                o = bpy.data.objects.new(f"{NAME}_{tag}_{w['label']}_{'l' if sign > 0 else 'r'}", mesh)
                o.location = (x + dx, w["y"], w["z"])
                bpy.context.scene.collection.objects.link(o)
                objs.append(o)
    print(f"  円柱の車輪を {len(objs)} 個作成（半径 {r:.3f} / 幅 {depth:.3f}）")
    return objs


def _protect_creases(obj, angle_deg=None, min_chain=None):
    """稜線上の頂点を平滑化の対象から外す頂点グループを作る。

    ★角度だけでは分離できない（2026-08-20 実測）。リア窓の枠は「丸い浅い凹み」で
      **20〜45度**の帯にあり、スキャンのノイズと同じ範囲に重なる。
      55度で守るとノイズは除けるが窓枠も守れず、20度まで下げるとノイズごと守ってしまう。

      見分けるのは**長さ**。窓枠やドア境界は「長く繋がった1本の線」になるが、
      ノイズは短い辺が散らばるだけ。角度で候補を拾い、**繋がった鎖の総延長**で選別する。
    """
    angle_deg = ANGLE_CANDIDATE if angle_deg is None else angle_deg
    min_chain = MIN_CHAIN_LENGTH if min_chain is None else min_chain
    mesh = obj.data
    vg = obj.vertex_groups.get("smoothable") or obj.vertex_groups.new(name="smoothable")
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    thr = math.radians(angle_deg)

    candidates = []
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        a, b = e.link_faces
        if a.normal.length and b.normal.length and a.normal.angle(b.normal) > thr:
            candidates.append(e)

    # 候補の辺を「頂点を共有しているか」で繋いで鎖にする
    cand = set(candidates)
    seen = set()
    protected = set()
    kept_chains = 0
    for e0 in candidates:
        if e0 in seen:
            continue
        stack = [e0]
        chain = []
        seen.add(e0)
        while stack:
            e = stack.pop()
            chain.append(e)
            for v in e.verts:
                for ne in v.link_edges:
                    if ne in cand and ne not in seen:
                        seen.add(ne)
                        stack.append(ne)
        total = sum((e.verts[0].co - e.verts[1].co).length for e in chain)
        if total >= min_chain:
            kept_chains += 1
            for e in chain:
                # ★シャープの印を付ける。平滑化から外すだけでは足りず、
                #   **平面統合そのものが窓枠を溶かす**（30度で統合＝20〜40度帯の窓枠は消える）。
                #   印を付けておけば delimit={'SHARP'} で統合がここを越えなくなる。
                e.smooth = False
                protected.add(e.verts[0].index)
                protected.add(e.verts[1].index)

    bm.to_mesh(mesh)
    bm.free()
    free = [v.index for v in mesh.vertices if v.index not in protected]
    vg.add(free, 1.0, "REPLACE")
    if protected:
        vg.add(sorted(protected), 0.0, "REPLACE")
    print(f"  稜線を保護: 候補{len(candidates)}辺 → 長い鎖{kept_chains}本 / {len(protected)}頂点")
    return vg


def denoise_and_flatten(obj):
    """平面を統合する。稜線は印を付けて越えないようにする。

    ★平滑化は既定で**行わない**（SMOOTH_ITER=0）。工程ごとに切り分けた結果、
      **リア窓の枠を溶かしていた犯人は平滑化だった**（2026-08-20）。
      稜線「上の」頂点を保護しても、すぐ隣の頂点が平滑化されて両側から段差を潰すため効かない。
      そもそも平滑化はノイズ対策だったが、粗い減面（Collapse 0.08）の直後には
      既にノイズが十分均されている（この時点で枠が完全に残っていることを確認済み）。
    """
    _protect_creases(obj)   # 稜線にシャープの印を付ける（平面統合が越えないように）
    if SMOOTH_ITER > 0:
        vg = obj.vertex_groups.get("smoothable")
        sm = obj.modifiers.new("smooth", "SMOOTH")
        sm.factor = SMOOTH_FACTOR
        sm.iterations = SMOOTH_ITER
        if vg:
            sm.vertex_group = vg.name
    pl = obj.modifiers.new("planar", "DECIMATE")
    pl.decimate_type = "DISSOLVE"
    pl.angle_limit = math.radians(PLANAR_ANGLE)
    # 印を付けた稜線を越えて統合しない。MATERIAL も入れないと**窓と車体が1枚に
    # 統合されて塗り分けが溶ける**（テクスチャ分類は減面前に済ませてある）
    pl.delimit = {"SHARP", "MATERIAL"}
    bpy.context.view_layer.objects.active = obj
    if SMOOTH_ITER > 0:
        bpy.ops.object.modifier_apply(modifier="smooth")
    bpy.ops.object.modifier_apply(modifier="planar")
    return obj


def cull_hidden_faces(obj):
    """外からどの向きにも見えない面を削る（車内・シート・ダッシュボードなど）。

    ★生成モデルは車内まで作り込まれている。地図でも詳細ページでも中は見えないのに
      面数を食い、**窓越しに内装の破片が覗いて汚く見える**（2026-08-20 ユーザー指摘の
      「窓の中の赤い破片」）。面の重心から全方位へレイを飛ばし、
      1本も外へ抜けない面を落とす。
    """
    if HIDDEN_CULL_RAYS <= 0:
        return obj
    from mathutils.bvhtree import BVHTree

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bm.normal_update()
    bvh = BVHTree.FromBMesh(bm)

    lo = Vector((min(v.co[i] for v in bm.verts) for i in range(3)))
    hi = Vector((max(v.co[i] for v in bm.verts) for i in range(3)))
    reach = (hi - lo).length * 1.5

    # 球面上に均等な向きを撒く（黄金角の螺旋）
    dirs = []
    n = HIDDEN_CULL_RAYS
    ga = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n):
        z = 1 - (2 * i + 1) / n
        r = math.sqrt(max(0.0, 1 - z * z))
        th = ga * i
        dirs.append(Vector((math.cos(th) * r, math.sin(th) * r, z)))

    doomed = []
    for f in bm.faces:
        origin = f.calc_center_median() + f.normal * 0.003
        seen = False
        for d in dirs:
            if d.dot(f.normal) <= 0.1:   # 面の裏側からは見えない
                continue
            if bvh.ray_cast(origin, d, reach)[0] is None:
                seen = True
                break
        if not seen:
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    print(f"  外から見えない面を削除: {len(doomed):,} 枚 → 残り {len(obj.data.polygons):,} 面")
    return obj


def finalize_shading(obj):
    """頂点を溶接して法線を共有させる。**幾何は動かさない**。

    ★生成モデルは同じ位置に頂点が重複していて、法線が面ごとにバラバラになる。
      そのまま出すと平らな面が**多角形のボコボコとして陰影に出る**（2026-08-20 ユーザー指摘）。
      溶接して角度制限つきの smooth shading を掛けると、幾何はそのままで滑らかに見える。
      ★頂点を動かす Smooth モディファイア（リア窓を溶かした犯人）とは**別物**。混同しない。
      副産物として頂点数が減り、glb も小さくなる。
    """
    before_v = len(obj.data.vertices)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=WELD_DISTANCE)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    print(f"  溶接 {before_v:,} → {len(obj.data.vertices):,} 頂点")
    drop_specks(obj)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(SHADE_SMOOTH_ANGLE))
    print(f"  {SHADE_SMOOTH_ANGLE}度で法線を共有")
    return obj


def drop_specks(obj):
    """小さすぎる塗り分けの島を車体色に倒す。

    ★テクスチャには汚し・陰影が焼かれていて、その暗い部分を窓や黒物として拾ってしまう。
      減面すると細長い破片として車体に散る（2026-08-20 ユーザー指摘「傷だらけ」）。
      **溶接した後なら連結成分が取れる**ので、面積の小さい島だけを落とせる。
      窓のような広い面や、繋がった窓枠は残る。
    """
    if SPECK_MAX_AREA <= 0:
        return obj
    me = obj.data
    names = [m.name if m else "" for m in me.materials]
    body_idx = next((i for i, n in enumerate(names) if n.endswith("_body")), None)
    if body_idx is None:
        return obj

    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    seen = set()
    moved_faces = 0
    moved_islands = 0
    for f in bm.faces:
        if f.index in seen or f.material_index == body_idx:
            continue
        mat = f.material_index
        comp = []
        stack = [f]
        seen.add(f.index)
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for e in cur.edges:
                for nf in e.link_faces:
                    if nf.index in seen or nf.material_index != mat:
                        continue
                    seen.add(nf.index)
                    stack.append(nf)
        if sum(c.calc_area() for c in comp) < SPECK_MAX_AREA:
            for c in comp:
                c.material_index = body_idx
            moved_faces += len(comp)
            moved_islands += 1
    bm.to_mesh(me)
    bm.free()
    me.update()
    print(f"  破片を車体色へ: {moved_islands} 島 / {moved_faces} 面")
    return obj


def triangles(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    m = obj.evaluated_get(dg).to_mesh()
    n = sum(max(len(p.vertices) - 2, 0) for p in m.polygons)
    obj.evaluated_get(dg).to_mesh_clear()
    return n


def _copy_with_materials(obj, keep, new_name):
    """指定マテリアルの面だけを持つ複製を作る。**幾何は動かさない**ので重ねてもズレない。"""
    me = obj.data.copy()
    dup = bpy.data.objects.new(new_name, me)
    bpy.context.scene.collection.objects.link(dup)
    dup.matrix_world = obj.matrix_world.copy()
    names = [m.name if m else "" for m in me.materials]
    bm = bmesh.new()
    bm.from_mesh(me)
    doomed = [f for f in bm.faces if names[f.material_index] not in keep]
    # context="FACES" は面と、他で使われていない辺・頂点も一緒に消す
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.update()
    return dup


def _export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_draco_mesh_compression_enable=False,
                              export_apply=True, export_yup=True)
    return path


def build():
    obj = import_and_normalize()
    # ★分類は**あらゆる減面より前**、原本のまま行う。減面すると面の UV 重心が
    #   UV アイランドの外（＝テクスチャの黒い隙間）に落ち、車体に黒い引っかき傷が散る
    #   （2026-08-20 実測。pre_collapse 後に分類していたのが原因だった）
    if CLASSIFY_MATERIALS:
        classes = classify_by_texture(obj)
    else:
        classes = None
        resize_source_textures(obj)
        print("  面単位の塗り分けを省略（原本テクスチャを使用）")
    pre_dissolve(obj)
    smooth_material_boundaries(obj)   # ★平面統合の前に均す（境界が細かいと統合が止まる）
    pre_collapse(obj)
    wheels = detect_wheels(obj) if REBUILD_WHEELS else []
    if REBUILD_WHEELS:
        remove_wheel_geometry(obj, wheels)
    else:
        print("  原本の車輪を保持")
    denoise_and_flatten(obj)
    cull_hidden_faces(obj)   # ★統合後に削るほうがレイの本数が少なく済む
    finalize_shading(obj)
    half_w = max(abs(v.co.x) for v in obj.data.vertices)
    wheel_objs = build_clean_wheels(wheels, half_w) if REBUILD_WHEELS else []

    total = triangles(obj) + sum(triangles(o) for o in wheel_objs)
    os.makedirs(OUT_DIR, exist_ok=True)
    blend = os.path.join(OUT_DIR, f"{NAME}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    glb = os.path.join(OUT_DIR, f"{NAME}_raw.glb")
    bpy.ops.object.select_all(action="SELECT")
    # ★詳細ページ用は Draco を掛けてよい（Three.js は読める）。
    #   地図用の tinted / fixed は **Mapbox の model レイヤーが Draco を読めない**ので
    #   `_export()` 側では必ず無効のままにする。
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB",
                              export_draco_mesh_compression_enable=DRACO,
                              export_draco_mesh_compression_level=6,
                              export_apply=True, export_yup=True)

    # ★地図用の2レイヤー分割。model-color はモデル全体に掛かるので、
    #   「車体色を塗る面」と「塗らない面」を別ファイルにして重ねる（memory: hakotora-3d-models）
    if classes:
        body = _copy_with_materials(obj, {f"{NAME}_body"}, f"{NAME}_tinted")
        rest = _copy_with_materials(obj, {f"{NAME}_{k}" for k in UNTINTED}, f"{NAME}_fixed")
        _export([body], os.path.join(OUT_DIR, f"{NAME}_tinted_raw.glb"))
        _export([rest] + wheel_objs, os.path.join(OUT_DIR, f"{NAME}_fixed_raw.glb"))
        print(f"  2レイヤー分割: tinted {triangles(body):,} / "
              f"fixed {triangles(rest) + sum(triangles(o) for o in wheel_objs):,} 三角形")
        # 分割用の複製はシーンに残さない（.blend は分割前の状態を正とする）
        for d in (body, rest):
            bpy.data.objects.remove(d, do_unlink=True)

    return total, blend, glb


# `SKIP_BUILD = True` を先に定義しておくと、関数だけ読み込んで自分で組み立てられる
# （途中経過を調べるとき用）。
if not globals().get("SKIP_BUILD"):
    total, blend, glb = build()
    result = f"{total:,} 三角形 -> {glb}"
    print(result)
