#!/usr/bin/env node
// 取り込んだ全仕様の部品分割・実寸・灯火・前後プレートの一致を、実GLBで検査する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const assets = JSON.parse(readFileSync("apps/web/src/lib/vehicleModelAssets.json", "utf8"));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const primitives = doc => doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
const triangles = doc => primitives(doc).reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3, 0);
let totalBytes = 0;
for (const a of assets) {
  const base = `apps/web/public/models/${a.id}`;
  const docs = await Promise.all([`${base}.glb`, `${base}-tinted.glb`, `${base}-fixed.glb`, `${base}-lamps.glb`, `apps/web/src/server/vehicles/plate-blanks/${a.id}.glb`, ...["hood", "front-bumper", "rear-bumper"].map(p => `${base}-${p}.glb`)].map(file => { totalBytes += readFileSync(file).length; return io.read(file); }));
  const [full, tinted, fixed, lamps, plate] = docs;
  const bounds = getBounds(full.getRoot().listScenes()[0]);
  assert.ok(Math.abs(bounds.min[1]) < 0.02, `${a.key}: 接地面`);
  assert.ok(Math.abs(bounds.max[0] - bounds.min[0] - a.lengthMeters) < 0.18, `${a.key}: 全長`);
  assert.equal(triangles(full), docs.slice(1).reduce((n, d) => n + triangles(d), 0), `${a.key}: 部品の欠落・重複`);
  for (const part of docs.slice(5)) assert.ok(triangles(part) > 0, `${a.key}: 部位の面`);
  const paintNames = new Set(["Body White", "Body Crease"]);
  assert.ok(primitives(tinted).every(p => paintNames.has(p.getMaterial()?.getName())), `${a.key}: 車体色`);
  assert.ok(primitives(fixed).every(p => !/plate/i.test(p.getMaterial()?.getName() ?? "")), `${a.key}: プレート重複`);
  const lampNames = new Set(lamps.getRoot().listMaterials().map(m => m.getName()));
  assert.ok(lampNames.has("Headlight Lens") && lampNames.has("Rear Red Lens"), `${a.key}: 前後灯火`);
  // 分割した位置・変換が元の車体と同じで、部品だけ移動・再正規化されていない。
  const sourceNodes = new Map(full.getRoot().listNodes().map(n => [n.getName(), n]));
  for (const doc of docs.slice(1)) for (const node of doc.getRoot().listNodes()) {
    assert.deepEqual(node.getWorldMatrix(), sourceNodes.get(node.getName())?.getWorldMatrix(), `${a.key}: 部品の座標変換`);
    for (const p of node.getMesh()?.listPrimitives() ?? []) {
      const positions = p.getAttribute("POSITION").getArray();
      assert.ok([...positions].every(Number.isFinite), `${a.key}: 頂点`);
    }
  }
  const plateBounds = getBounds(plate.getRoot().listScenes()[0]);
  assert.ok(plateBounds.min[0] < -1 && plateBounds.max[0] > 1, `${a.key}: 前後のプレート`);
  for (const p of primitives(plate)) assert.ok([...p.getAttribute("TEXCOORD_0").getArray()].every(n => Number.isFinite(n) && n >= -0.001 && n <= 1.001), `${a.key}: プレートUV`);
}
console.log(`${assets.length}仕様 / ${assets.length * 8} GLB: 部品・座標・接地・灯火・前後プレート正常 (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
