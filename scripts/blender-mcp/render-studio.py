"""
車両モデルを「資料用の静止画」として撮る。

参考にしている見え方（ユーザー提示の ChatGPT 生成画像）は、
**写実ではなく「均一な光でスタジオ撮影した、質感を抑えた3Dレンダー」**。
そこへ寄せるための設定をここに固定する。モデルの形ではなく光と質感の担当。

- Cycles（CPU）。EEVEE はヘッドレスで GL コンテキストが要るため避ける
- 面光源3灯（キー・フィル・リム）＋ 明るい環境光。影は柔らかく、真っ黒にしない
- 背景は無限遠に見える無地。床は影だけ拾う
- 車体は「わずかに光沢のある塗装」。金属にはしない（写実に寄りすぎる）

使い方:
    python3 scripts/blender-mcp/bridge.py exec scripts/blender-mcp/render-studio.py

`TARGET_BLEND` を編集すれば別の .blend を撮れる。**保存はしない**（作業中のファイルを壊さないため）。
"""

import math
import os

import bpy
from mathutils import Vector

TARGET_BLEND = os.path.expanduser("~/Developer/assets/hakotora-3d/keivan/keivan_work.blend")
OUT_DIR = "/tmp"
SAMPLES = 96
RESOLUTION = (1100, 800)

# 撮る角度（車の前が -X のモデル基準）。参考画像と同じ「前方斜め・やや見下ろし」
VIEWS = {
    "hero": (-0.95, -1.0, 0.40),
    "front": (-1.0, -0.32, 0.24),
}

BACKDROP_GRAY = 0.62   # 参考画像の背景に近い中間グレー
WORLD_GRAY = 0.78      # 環境光。暗くすると途端に写実寄りになる


def load():
    bpy.ops.wm.open_mainfile(filepath=TARGET_BLEND)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def bounds(objects):
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objects:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


def tune_materials():
    """資料用の質感へ寄せる。塗り分け（どの面がどのマテリアルか）は触らない。"""
    tuning = {
        "keivan_body": dict(color=(0.90, 0.90, 0.91, 1), rough=0.35, spec=0.45),
        "keivan_glass": dict(color=(0.055, 0.06, 0.075, 1), rough=0.12, spec=0.60),
        "keivan_tire": dict(color=(0.035, 0.035, 0.04, 1), rough=0.85, spec=0.20),
        "keivan_rim": dict(color=(0.78, 0.79, 0.81, 1), rough=0.30, spec=0.55),
        "keivan_plate": dict(color=(0.93, 0.85, 0.28, 1), rough=0.45, spec=0.35),
    }
    for name, cfg in tuning.items():
        mat = bpy.data.materials.get(name)
        if not mat or not mat.node_tree:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        # ソケットは identifier で引く（UI 言語が日本語だと name が翻訳される）
        for ident, value in (
            ("Base Color", cfg["color"]),
            ("Roughness", cfg["rough"]),
            ("Specular IOR Level", cfg["spec"]),
            ("Metallic", 0.0),
        ):
            sock = next((s for s in bsdf.inputs if s.identifier == ident), None)
            if sock is not None:
                sock.default_value = value


def add_cavity_shading(mat_names, distance=0.045, strength=0.92):
    """凹みを自動的に暗くする（アンビエントオクルージョン）。

    ★参考画像でグリルやパネルの隙間が暗いのは「そういう色」だけでなく
      **凹みに光が入らない影**でもある。面を選んで塗り分けようとすると、
      減面メッシュ上では判定が破綻する（窓・タイヤ・グリルで3回失敗）。
      AO を色に掛ければ、**面を1つも選ばずに**凹みが全部暗くなる。

    ノードは type、ソケットは identifier で引く（日本語UIでは name が翻訳される）。
    """
    for name in mat_names:
        mat = bpy.data.materials.get(name)
        if not mat or not mat.node_tree:
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        base = next((s for s in bsdf.inputs if s.identifier == "Base Color"), None)
        if base is None or base.is_linked:
            continue

        ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
        ao.samples = 16
        next(s for s in ao.inputs if s.identifier == "Distance").default_value = distance
        next(s for s in ao.inputs if s.identifier == "Color").default_value = (1, 1, 1, 1)

        # AO の白黒を「どのくらい効かせるか」に変換（1=そのまま, 0=効かせない）
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.0
        ramp.color_ramp.elements[0].color = (1 - strength, 1 - strength, 1 - strength, 1)
        ramp.color_ramp.elements[1].position = 0.99  # 浅い凹みにも効かせる
        ramp.color_ramp.elements[1].color = (1, 1, 1, 1)

        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        next(s for s in mix.inputs if s.identifier == "Factor_Float").default_value = 1.0
        next(s for s in mix.inputs if s.identifier == "A_Color").default_value = base.default_value[:]

        nt.links.new(ao.outputs["Color"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], next(s for s in mix.inputs if s.identifier == "B_Color"))
        nt.links.new(next(o for o in mix.outputs if o.identifier == "Result_Color"), base)


def build_studio(objects):
    lo, hi = bounds(objects)
    center = (lo + hi) / 2
    size = (hi - lo).length

    # 背景（無地の壁）と床。床は影だけ受ける
    bpy.ops.mesh.primitive_plane_add(size=size * 14, location=(center.x, center.y, lo.z))
    floor = bpy.context.active_object
    floor.name = "__floor"
    mat = bpy.data.materials.new("__backdrop")
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")  # 名前ではなく型で
    next(s for s in bsdf.inputs if s.identifier == "Base Color").default_value = (
        BACKDROP_GRAY, BACKDROP_GRAY, BACKDROP_GRAY, 1,
    )
    next(s for s in bsdf.inputs if s.identifier == "Roughness").default_value = 0.95
    floor.data.materials.append(mat)

    world = bpy.data.worlds.new("__studio")
    world.use_nodes = True
    # ★ノードは名前で引かない。UI 言語が日本語だと「背景」になり KeyError になる
    #   （Principled BSDF で踏んだのと同じ罠。2026-08-19 再発）
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (WORLD_GRAY, WORLD_GRAY, WORLD_GRAY, 1)
    bg.inputs[1].default_value = 1.0
    bpy.context.scene.world = world

    # 面光源3灯。大きく・弱く当てて影を柔らかくする
    def area(name, direction, energy, scale):
        bpy.ops.object.light_add(type="AREA", location=center + Vector(direction).normalized() * size * 2.2)
        light = bpy.context.active_object
        light.name = name
        light.data.energy = energy
        light.data.size = size * scale
        d = center - light.location
        light.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        return light

    area("__key", (-0.7, -1.0, 0.85), size * size * 26, 1.5)
    area("__fill", (1.0, -0.55, 0.30), size * size * 9, 2.0)
    area("__rim", (0.6, 1.0, 0.75), size * size * 12, 1.2)
    return center, size


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"  # Filmic だと白が濁る
    return scene


def shoot(scene, center, size, name, direction):
    cam_data = bpy.data.cameras.get("__cam") or bpy.data.cameras.new("__cam")
    cam_data.lens = 75  # 望遠寄り＝歪みが少なく、製品写真らしくなる
    cam = bpy.data.objects.get("__cam")
    if cam is None:
        cam = bpy.data.objects.new("__cam", cam_data)
        scene.collection.objects.link(cam)
    cam.data = cam_data
    d = Vector(direction).normalized() * (size * 2.15)
    cam.location = center + d
    cam.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    scene.camera = cam
    out = os.path.join(OUT_DIR, f"studio_{name}.png")
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    return out


objects = load()
tune_materials()
# 凹み（グリルのスリット・パネルの隙間・ライトの縁）を影で出す
add_cavity_shading(["keivan_body", "keivan_plate", "keivan_rim"])
center, size = build_studio(objects)
scene = setup_render()
outputs = [shoot(scene, center, size, name, d) for name, d in VIEWS.items()]
result = ", ".join(outputs)
print(result)
