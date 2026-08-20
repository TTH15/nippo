// glb に入っているテクスチャ画像を取り出す（塗り分けの材料があるかを調べる用）
// 使い方: node scripts/glb-textures.mjs <入力.glb> <出力ディレクトリ>
import { mkdirSync, writeFileSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [input, outDir] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
mkdirSync(outDir, { recursive: true });

doc.getRoot().listTextures().forEach((tex, i) => {
  const mime = tex.getMimeType() || "image/png";
  const ext = mime.split("/")[1].replace("jpeg", "jpg");
  const size = tex.getSize();
  const name = `${String(i).padStart(2, "0")}_${(tex.getName() || "tex").replace(/[^\w.-]/g, "_")}.${ext}`;
  writeFileSync(`${outDir}/${name}`, Buffer.from(tex.getImage()));
  console.log(`${name}  ${size ? size.join("x") : "?"}  ${(tex.getImage().byteLength / 1024 / 1024).toFixed(1)}MB`);
});

doc.getRoot().listMaterials().forEach((m) => {
  const slots = ["BaseColor", "Normal", "MetallicRoughness", "Emissive", "Occlusion"];
  const has = slots.filter((s) => m[`get${s}Texture`]?.());
  console.log(
    `material=${m.getName() || "(無名)"} baseColorFactor=${m.getBaseColorFactor()} texture=[${has.join(", ")}]`,
  );
});

// UV があるか（テクスチャから面の色を引けるか）
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    console.log(`prim semantics=[${prim.listSemantics().join(", ")}]`);
  }
}
