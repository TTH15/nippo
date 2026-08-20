#!/usr/bin/env node
// ============================================================
// glb を「Mapbox の model レイヤーが読める形」に整えるだけの仕上げ（2026-08-19）。
//
// `prepare-vehicle-glb.mjs` との違い:
//   あちらは Meshy の生モデル向けで、**実寸化・原点合わせ・簡略化まで行う**。
//   1台を複数ファイルに分けて重ねる用途では、ファイルごとに別々の倍率・中心で
//   正規化されてしまい、**重ねたときにズレる**。
//   こちらは幾何を一切動かさず、ローダー対策だけを行う。
//
// やること（Mapbox で実際に踏んだ3つの地雷。詳細は memory: hakotora-3d-models）:
//   1) 頂点属性のインターリーブを解く（VertexLayout.SEPARATE）
//   2) プリミティブ間のアクセサ共有を解消（プリミティブごとに頂点を詰め直す）
//   3) Draco 圧縮は使わない
//
// 使い方:
//   node scripts/finish-glb-for-mapbox.mjs <入力.glb> <出力.glb>
// ============================================================

import { readFileSync } from "node:fs";
import { NodeIO, VertexLayout } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("使い方: node scripts/finish-glb-for-mapbox.mjs <入力.glb> <出力.glb>");
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
const doc = await io.read(input);
const root = doc.getRoot();

// プリミティブごとに頂点データを独立させる。
// Mapbox の model ローダーはアクセサを共有した複数プリミティブを読めず、
// 「RangeError: offset is out of bounds」で落ちる（2026-08-10 実機で確認）。
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    if (!idx) continue;
    const remap = new Map();
    const newIndices = [];
    for (let i = 0; i < idx.getCount(); i++) {
      const old = idx.getScalar(i);
      let next = remap.get(old);
      if (next === undefined) {
        next = remap.size;
        remap.set(old, next);
      }
      newIndices.push(next);
    }
    for (const name of prim.listSemantics()) {
      const attr = prim.getAttribute(name);
      const size = attr.getElementSize();
      const packed = new Float32Array(remap.size * size);
      const el = new Array(size).fill(0);
      for (const [oldIndex, newIndex] of remap) {
        attr.getElement(oldIndex, el);
        packed.set(el, newIndex * size);
      }
      prim.setAttribute(name, doc.createAccessor().setType(attr.getType()).setArray(packed));
    }
    const Arr = remap.size <= 65535 ? Uint16Array : Uint32Array;
    prim.setIndices(doc.createAccessor().setArray(new Arr(newIndices)));
  }
}

for (const acc of root.listAccessors()) {
  if (acc.listParents().length <= 1) acc.dispose();
}

await io.write(output, doc);

let tris = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    tris += (idx ? idx.getCount() : prim.getAttribute("POSITION").getCount()) / 3;
  }
}
console.log(
  `完成: ${output}（${(readFileSync(output).length / 1024).toFixed(0)} KB / ${tris.toLocaleString()} 三角形）` +
    " — 幾何は動かしていないので、複数ファイルを重ねても位置が揃う",
);
