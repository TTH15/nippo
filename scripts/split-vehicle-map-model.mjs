#!/usr/bin/env node
// Mapbox の model レイヤーで、車体色を強く出しつつ窓・タイヤ・灯火の色を保つため、
// 位置と縮尺を変えずに1台の GLB を「着色する車体」と「固定色の部品」へ分割する。
//
// 使い方:
//   node scripts/split-vehicle-map-model.mjs <入力.glb> <車体.glb> <固定色.glb>

// 入力は finish-glb-for-mapbox.mjs で整えたファイルを想定する。

import { readFileSync } from "node:fs";
import { NodeIO, PropertyType, VertexLayout } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [input, tintedOutput, fixedOutput] = process.argv.slice(2);
if (!input || !tintedOutput || !fixedOutput) {
  console.error("使い方: node scripts/split-vehicle-map-model.mjs <入力.glb> <車体.glb> <固定色.glb>");
  process.exit(1);
}

const TINTED_MATERIALS = new Set([
  "Body White",
  "Paint Hood",
  "Paint Front Bumper",
  "Paint Rear Bumper",
  "Body Crease",
]);
const PLATE_MATERIALS = new Set(["License Plate Front"]);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .setVertexLayout(VertexLayout.SEPARATE);

async function writePart(output, part) {
  const doc = await io.read(input);
  const root = doc.getRoot();

  for (const mesh of root.listMeshes()) {
    for (const primitive of [...mesh.listPrimitives()]) {
      const materialName = primitive.getMaterial()?.getName() ?? "";
      const keep = part === "tinted"
        ? TINTED_MATERIALS.has(materialName)
        : !TINTED_MATERIALS.has(materialName) && !PLATE_MATERIALS.has(materialName);
      if (!keep) primitive.dispose();
    }
    if (mesh.listPrimitives().length === 0) {
      for (const node of root.listNodes()) {
        if (node.getMesh() === mesh) node.setMesh(null);
      }
      mesh.dispose();
    }
  }

  for (const material of root.listMaterials()) {
    const used = material.listParents().some((parent) => parent.propertyType === PropertyType.PRIMITIVE);
    if (!used) material.dispose();
  }
  for (const accessor of root.listAccessors()) {
    const used = accessor.listParents().some((parent) => parent.propertyType !== PropertyType.ROOT);
    if (!used) accessor.dispose();
  }

  await io.write(output, doc);

  let triangles = 0;
  let primitives = 0;
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      triangles += (indices ? indices.getCount() : primitive.getAttribute("POSITION").getCount()) / 3;
      primitives += 1;
    }
  }
  console.log(
    `${part === "tinted" ? "車体" : "固定色"}: ${output} ` +
      `(${(readFileSync(output).length / 1024).toFixed(0)} KB / ${triangles.toLocaleString()} 三角形 / ${primitives} primitive)`,
  );
}

await writePart(tintedOutput, "tinted");
await writePart(fixedOutput, "fixed");
