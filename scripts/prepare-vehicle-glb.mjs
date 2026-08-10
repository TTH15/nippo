#!/usr/bin/env node
// ============================================================
// 地図に載せる車両 glb の仕上げ（2026-08-10）
//
// Meshy.ai の出力をそのまま地図に載せることはできない（200万三角形・34MB）。
// このスクリプトで「地図に載る形」へ整える:
//   1) simplify … 目標三角形数まで削減（既定 16,000）
//   2) 実寸へスケール … 軽バンの実寸（既定 全長3.4m）に合わせる
//   3) 原点を底面中心へ … ずれていると地図でズーム時に車体が流れる（2026-07-30 に一度踏んだ）
//   4) 出力（**Draco は使わない**）… 動いている truck.glb が非圧縮で、Mapbox の model レイヤーが
//      KHR_draco_mesh_compression を読める保証が無いため。16k 三角形なら非圧縮でも 300KB 程度
//
// 使い方:
//   node scripts/prepare-vehicle-glb.mjs <入力.glb> <出力.glb> [全長m] [目標三角形数]
//   例) node scripts/prepare-vehicle-glb.mjs public/glb/clipper_raw.glb apps/web/public/models/clipper.glb 3.4 16000
//
// 前提: npx @gltf-transform/cli が使える（初回はダウンロードが走る）
// ============================================================

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [input, output, lengthMStr = "3.4", targetTriStr = "16000"] = process.argv.slice(2);
if (!input || !output) {
  console.error("使い方: node scripts/prepare-vehicle-glb.mjs <入力.glb> <出力.glb> [全長m] [目標三角形数]");
  process.exit(1);
}
const lengthM = Number(lengthMStr);
const targetTri = Number(targetTriStr);

// --- 1) 三角形数を落とす -------------------------------------------------
// 元の三角形数から比率を出す（simplify は比率指定なので）
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const probe = await io.read(input);
let tris = 0;
for (const mesh of probe.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    tris += idx ? idx.getCount() / 3 : prim.getAttribute("POSITION").getCount() / 3;
  }
}
const ratio = Math.min(1, targetTri / Math.max(tris, 1));
console.log(`元: ${tris.toLocaleString()} 三角形 → 目標 ${targetTri.toLocaleString()}（ratio ${ratio.toFixed(4)}）`);

const tmp = `${output}.tmp.glb`;
execFileSync(
  "npx",
  ["--yes", "@gltf-transform/cli@4", "simplify", input, tmp, "--ratio", String(ratio), "--error", "0.002"],
  { stdio: "inherit" },
);

// --- 2) 実寸へスケール & 3) 原点を底面中心へ -----------------------------
const doc = await io.read(tmp);
const root = doc.getRoot();

// 現在の寸法を測る
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const el = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el);
      for (let k = 0; k < 3; k++) {
        if (el[k] < min[k]) min[k] = el[k];
        if (el[k] > max[k]) max[k] = el[k];
      }
    }
  }
}
const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
// 一番長い軸を全長とみなす（Meshy の出力は正規化されていて向きも一定ではない）
const longest = Math.max(size[0], size[2]);
const scale = lengthM / longest;
console.log(
  `寸法 ${size.map((n) => n.toFixed(2)).join(" × ")} → スケール ${scale.toFixed(3)} 倍（全長 ${lengthM}m）`,
);

// 頂点を直接動かす（ノードに scale を置くと Mapbox 側の model-scale と掛かって混乱するため）
const cx = ((min[0] + max[0]) / 2) * scale;
const cz = ((min[2] + max[2]) / 2) * scale;
const bottomY = min[1] * scale;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    const el = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el);
      pos.setElement(i, [el[0] * scale - cx, el[1] * scale - bottomY, el[2] * scale - cz]);
    }
  }
}
// --- 3.5) 法線が無ければ生成する ---------------------------------------
// Meshy の「generate」段階の出力は POSITION しか持たず、そのままだと陰影が出ずのっぺりする。
// テクスチャ工程まで回した出力なら法線もUVも入っているので、この処理は不要になる。
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    if (prim.getAttribute("NORMAL")) continue;
    const pos = prim.getAttribute("POSITION");
    const idx = prim.getIndices();
    const count = pos.getCount();
    const normals = new Float32Array(count * 3);
    const triCount = idx ? idx.getCount() / 3 : count / 3;
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const c = [0, 0, 0];
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getScalar(t * 3) : t * 3;
      const i1 = idx ? idx.getScalar(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getScalar(t * 3 + 2) : t * 3 + 2;
      pos.getElement(i0, a);
      pos.getElement(i1, b);
      pos.getElement(i2, c);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      for (const i of [i0, i1, i2]) {
        normals[i * 3] += n[0];
        normals[i * 3 + 1] += n[1];
        normals[i * 3 + 2] += n[2];
      }
    }
    for (let i = 0; i < count; i++) {
      const x = normals[i * 3];
      const y = normals[i * 3 + 1];
      const z = normals[i * 3 + 2];
      const len = Math.hypot(x, y, z) || 1;
      normals[i * 3] = x / len;
      normals[i * 3 + 1] = y / len;
      normals[i * 3 + 2] = z / len;
    }
    const accessor = doc.createAccessor().setType("VEC3").setArray(normals);
    prim.setAttribute("NORMAL", accessor);
    console.log("法線が無かったので生成した（テクスチャ版なら不要）");
  }
}

// マテリアルが無いと着色できないので、無彩色の既定マテリアルを付ける
if (root.listMaterials().length === 0) {
  const mat = doc
    .createMaterial("body")
    .setBaseColorFactor([0.92, 0.92, 0.93, 1])
    .setMetallicFactor(0.1)
    .setRoughnessFactor(0.6);
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getMaterial()) prim.setMaterial(mat);
    }
  }
  console.log("マテリアルが無かったので無彩色の既定を付けた（model-color で着色できる）");
}

await io.write(tmp, doc);

// --- 4) 出力 -------------------------------------------------------------
// ★Draco 圧縮はしない。Mapbox の model レイヤーが読めるか保証が無く、
//   既に動いている truck.glb も非圧縮のため（2026-08-10 に確認）。
await io.write(output, doc);
rmSync(tmp, { force: true });
console.log(`完成: ${output}（${(readFileSync(output).length / 1024).toFixed(0)} KB）`);
console.log("原点=底面中心 / 実寸 / 非圧縮。model-color で着色するため車体は無彩色にしておくこと");
