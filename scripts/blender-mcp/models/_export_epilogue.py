# keivan.py の後ろに連結して実行するための後半部分（export-keivan.sh が使う）。
# 単体では動かない。keivan.py が定義した join_by_material / build を前提にする。
import os

OUT_DIR = os.path.expanduser("~/Developer/assets/hakotora-3d/keivan")
os.makedirs(OUT_DIR, exist_ok=True)

# 1) 部品構成のまま .blend を保存する（手で触るときの正はこちら）
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "keivan.blend"))
before = len([o for o in bpy.context.scene.objects if o.type == "MESH"])

# 2) 書き出し用にマテリアル単位で結合する
#    部品ごとに別メッシュのまま出すと glTF の primitive が増え、地図に数十台
#    載せたときのドローコールがそのまま増える
merged = join_by_material()
# ★名前はここで文字列にしておく。build() が作り直すとオブジェクトは破棄され、
#   あとから o.name を読むと ReferenceError になる
merged_names = [o.name for o in merged]
after = len([o for o in bpy.context.scene.objects if o.type == "MESH"])

dg = bpy.context.evaluated_depsgraph_get()
tris = 0
for o in bpy.context.scene.objects:
    if o.type != "MESH":
        continue
    m = o.evaluated_get(dg).to_mesh()
    tris += sum(max(len(p.vertices) - 2, 0) for p in m.polygons)
    o.evaluated_get(dg).to_mesh_clear()

# 3) glb を書き出す（**Draco は使わない**。Mapbox の model レイヤーが読めない）
glb = os.path.join(OUT_DIR, "keivan_raw.glb")
bpy.ops.export_scene.gltf(
    filepath=glb,
    export_format="GLB",
    export_draco_mesh_compression_enable=False,
    export_apply=True,
    export_yup=True,
)

# 4) 結合済みのシーンを残すと次の編集ができないので、部品構成に戻す
build()

result = (
    f"{before} オブジェクト -> {after} プリミティブ "
    f"({', '.join(merged_names)}) / 三角形 {tris} / "
    f"{os.path.getsize(glb):,} bytes -> {glb}"
)
print(result)
