#!/usr/bin/env node
// 車種の地図モデルから「ナンバープレートの面だけ」を抜いた無地の型（blank）を作る。
//
// 実行時（車両登録時）にサーバーで貼るのは番号のテクスチャだけにしたいので、
// 幾何と UV はここで一度だけ用意しておく。元の車種モデルは 474〜754KB あって
// 関数へ同梱するには重いが、この型は 30KB 程度で済む。
// 型には番号が入らないため、リポジトリに置いても実車の情報は出ない。
//
// 使い方:
//   node scripts/build-plate-blank.mjs <入力の車種GLB> <出力のblank.glb>
//
// プレートの材質名は車種で違う（アクティ= "License Plate Front"／
// エブリイ・ハイゼット= "Front Plate"）ため、名前に plate を含む材質を拾う。

import { readFileSync } from "node:fs";
import { Accessor, NodeIO, PropertyType, VertexLayout } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("使い方: node scripts/build-plate-blank.mjs <入力.glb> <出力.glb>");
  process.exit(1);
}

const isPlateMaterial = (name) => /plate/i.test(name ?? "");

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
const doc = await io.read(input);
const root = doc.getRoot();

const kept = [];
for (const mesh of root.listMeshes()) {
  for (const primitive of [...mesh.listPrimitives()]) {
    const name = primitive.getMaterial()?.getName();
    if (isPlateMaterial(name)) kept.push(name);
    else primitive.dispose();
  }
  if (mesh.listPrimitives().length === 0) {
    for (const node of root.listNodes()) if (node.getMesh() === mesh) node.setMesh(null);
    mesh.dispose();
  }
}
if (kept.length === 0) {
  console.error(`プレートの材質が見つかりません: ${input}`);
  process.exit(1);
}

for (const material of root.listMaterials()) {
  if (!material.listParents().some((parent) => parent.propertyType === PropertyType.PRIMITIVE)) material.dispose();
}
for (const accessor of root.listAccessors()) {
  if (!accessor.listParents().some((parent) => parent.propertyType !== PropertyType.ROOT)) accessor.dispose();
}

// 前後のプレートは向かい合っているので、x の符号で分けてそれぞれ正面から見た UV を張る。
// （前から見ても後ろから見ても番号が正しい向きに読めるようにするため）
let triangles = 0;
for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute("POSITION");
    triangles += (primitive.getIndices()?.getCount() ?? position.getCount()) / 3;
    const sideBounds = new Map();
    const point = [0, 0, 0];
    for (let i = 0; i < position.getCount(); i += 1) {
      position.getElement(i, point);
      const side = point[0] >= 0 ? 1 : -1;
      const bounds = sideBounds.get(side) ?? { minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
      bounds.minY = Math.min(bounds.minY, point[1]);
      bounds.maxY = Math.max(bounds.maxY, point[1]);
      bounds.minZ = Math.min(bounds.minZ, point[2]);
      bounds.maxZ = Math.max(bounds.maxZ, point[2]);
      sideBounds.set(side, bounds);
    }
    const uv = new Float32Array(position.getCount() * 2);
    for (let i = 0; i < position.getCount(); i += 1) {
      position.getElement(i, point);
      const side = point[0] >= 0 ? 1 : -1;
      const bounds = sideBounds.get(side);
      const across = (point[2] - bounds.minZ) / Math.max(1e-6, bounds.maxZ - bounds.minZ);
      uv[i * 2] = side > 0 ? 1 - across : across;
      uv[i * 2 + 1] = (bounds.maxY - point[1]) / Math.max(1e-6, bounds.maxY - bounds.minY);
    }
    primitive.setAttribute("TEXCOORD_0", doc.createAccessor("plate-uv").setType(Accessor.Type.VEC2).setArray(uv));
    // 実行時に番号のテクスチャを差し込む1材質へ寄せる
    primitive.getMaterial()
      .setName("Plate")
      .setBaseColorFactor([1, 1, 1, 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(0.78);
  }
}

await io.write(output, doc);
console.log(
  `完成: ${output}（${(readFileSync(output).length / 1024).toFixed(0)} KB / ${Math.round(triangles)} 三角形 / 材質 ${[...new Set(kept)].join(", ")}）`,
);
