#!/usr/bin/env node
// ============================================================
// 地図に載せる車両 glb の仕上げ（2026-08-10）
//
// Meshy.ai の出力をそのまま地図に載せることはできない（200万三角形・34MB）。
// このスクリプトで「地図に載る形」へ整える:
//   0) テクスチャ縮小 … 4K のままだと1台で90MB超。地図上の車は数十pxなので 1K で十分
//      ※ style=flat（既定）ならテクスチャは**捨てる**。写実的な質感は暗い抽象的な地図から浮くうえ、
//        焼き込まれた影や汚れが model-color の着色を濁らせるため（2026-08-10 ユーザー指摘）
//   1) simplify … 目標三角形数まで削減（既定 16,000）
//   2) 実寸へスケール … 軽バンの実寸（既定 全長3.4m）に合わせる
//   3) 原点を底面中心へ … ずれていると地図でズーム時に車体が流れる（2026-07-30 に一度踏んだ）
//   4) 出力（**Draco は使わない**）… 動いている truck.glb が非圧縮で、Mapbox の model レイヤーが
//      KHR_draco_mesh_compression を読める保証が無いため。16k 三角形なら非圧縮でも 300KB 程度
//
// 使い方:
//   node scripts/prepare-vehicle-glb.mjs <入力.glb> <出力.glb> [全長m] [目標三角形数] [テクスチャpx] [flat|photo] [プレート色] [auto|none]
//
// ★プレートの自動切り出し（幾何条件）はモデルによって外す。バンパーに黒い破片が出るようなら
//   最後の引数に none を渡し、Blender で plate マテリアルを分けること（2026-08-11 実測）
//   例) node scripts/prepare-vehicle-glb.mjs public/glb/clipper_raw.glb apps/web/public/models/clipper.glb 3.4 16000
//
// 前提: npx @gltf-transform/cli が使える（初回はダウンロードが走る）
// ============================================================

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [
  input,
  output,
  lengthMStr = "3.4",
  targetTriStr = "16000",
  texSizeStr = "1024",
  style = "flat",
  plateColor = "#111827", // 事業用（黒ナンバー）。自家用なら白系を渡す
  plateMode = "auto", // auto=幾何条件で自動切り出し / none=切り出さない（Blender で分ける場合）
] = process.argv.slice(2);

/** #RRGGBB → glTF の baseColorFactor（sRGB→リニア近似） */
function hexToRgba(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x111827;
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const lin = srgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return [...lin, 1];
}
if (!input || !output) {
  console.error("使い方: node scripts/prepare-vehicle-glb.mjs <入力.glb> <出力.glb> [全長m] [目標三角形数]");
  process.exit(1);
}
const lengthM = Number(lengthMStr);
/** 「暗い部分（窓・タイヤ・グリル）」と見なす明度のしきい値 */
const DARK_LUMA = 0.18;
const targetTri = Number(targetTriStr);
const texSize = Number(texSizeStr);

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

// --- 0) テクスチャを縮小する ---------------------------------------------
// Meshy の 4K テクスチャは1台で 90MB を超える。地図上の車は画面で数十pxなので 1K で十分。
if (probe.getRoot().listTextures().length > 0) {
  execFileSync(
    "npx",
    ["--yes", "@gltf-transform/cli@4", "resize", tmp, tmp, "--width", String(texSize), "--height", String(texSize)],
    { stdio: "inherit" },
  );
}

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

// --- 3.6) 見た目の方針 ---------------------------------------------------
// flat: テクスチャを外し、無彩色のフラットな見た目にする（地図の抽象度に合わせる／着色が効く）
// photo: テクスチャを残す（実物に寄せたいとき）
if (style === "flat") {
  // ※ テクスチャの明度から窓・タイヤを自動判別する実装を試したが、
  //   写真由来テクスチャの UV とサンプリングが噛み合わず、車体に黒い斑が散る結果になった
  //   （2026-08-10 レンダリングで確認）。**マテリアル分けは Blender で手作業**に切り替える。
  for (const mat of root.listMaterials()) {
    // Blender で分けたマテリアル（glass / dark / plate）は色を保つ。
    // テクスチャだけ外し、body 相当だけ無彩色に整える
    const name = mat.getName();
    const isAuthored = name === "glass" || name === "dark" || name === "plate";
    mat.setBaseColorTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setNormalTexture(null);
    mat.setOcclusionTexture(null);
    mat.setEmissiveTexture(null);
    if (!isAuthored) {
      mat.setBaseColorFactor([0.93, 0.94, 0.96, 1]);
      mat.setMetallicFactor(0);
      mat.setRoughnessFactor(0.75);
    }
  }
  for (const tex of root.listTextures()) tex.dispose();
  // UV と接線はテクスチャを使わないなら無駄（接線は頂点あたり4float でファイルの大半を占める）
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const name of ["TEXCOORD_0", "TEXCOORD_1", "TANGENT"]) {
        const attr = prim.getAttribute(name);
        if (attr) {
          prim.setAttribute(name, null);
          attr.dispose();
        }
      }
    }
  }
  console.log("テクスチャ・UV・接線を外してフラットな見た目にした（style=flat）");
}

// --- 3.7) ナンバープレートを別マテリアルに切り出す -----------------------
// 生成モデルはメッシュもマテリアルも1つなので、そのままだとプレートが車体と同じ色になる
//（テクスチャ版だと「EVERY」や黄色いプレートが出てデジタルツイン感が落ちる・2026-08-10 指摘）。
// 前後の端にある「Xを向いた低い位置の小さな面」をプレートとみなし、黒（事業用＝黒ナンバー）にする。
// マテリアルを分けておけば、モバイル側（three.js 等）で色を差し替えられる。
if (plateMode === "none") {
  console.log("プレートの自動切り出しはしない（plateMode=none）");
} else if (root.listMaterials().some((m) => m.getName() === "plate")) {
  // Blender 側で plate を作ってあるなら、こちらで切り出さない（二重に作らない）
  console.log("plate マテリアルが既にあるので、プレートの自動切り出しはスキップ");
} else {
  const bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      const el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        bbox.minX = Math.min(bbox.minX, el[0]);
        bbox.maxX = Math.max(bbox.maxX, el[0]);
        bbox.minY = Math.min(bbox.minY, el[1]);
        bbox.maxY = Math.max(bbox.maxY, el[1]);
      }
    }
  }
  const spanX = bbox.maxX - bbox.minX;
  const plateMat = doc
    .createMaterial("plate")
    .setBaseColorFactor(hexToRgba(plateColor))
    .setMetallicFactor(0)
    .setRoughnessFactor(0.5);

  let moved = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of [...mesh.listPrimitives()]) {
      const pos = prim.getAttribute("POSITION");
      const idx = prim.getIndices();
      if (!idx) continue;
      const keep = [];
      const plate = [];
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      const c = [0, 0, 0];
      for (let t = 0; t < idx.getCount() / 3; t++) {
        const i0 = idx.getScalar(t * 3);
        const i1 = idx.getScalar(t * 3 + 1);
        const i2 = idx.getScalar(t * 3 + 2);
        pos.getElement(i0, a);
        pos.getElement(i1, b);
        pos.getElement(i2, c);
        const cx = (a[0] + b[0] + c[0]) / 3;
        const cy = (a[1] + b[1] + c[1]) / 3;
        const cz = (a[2] + b[2] + c[2]) / 3;
        // 面の向き（法線のX成分）
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const nx = e1[1] * e2[2] - e1[2] * e2[1];
        const ny = e1[2] * e2[0] - e1[0] * e2[2];
        const nz = e1[0] * e2[1] - e1[1] * e2[0];
        const nlen = Math.hypot(nx, ny, nz) || 1;
        // プレートは「車体の端にある・地上0.3〜0.7m・幅33cm・前後を向いた平らな面」。
        // 広く取るとバンパーやグリルまで黒くなるので、条件は厳しめにする
        const facingX = Math.abs(nx / nlen) > 0.75;
        const nearEnd = cx < bbox.minX + spanX * 0.06 || cx > bbox.maxX - spanX * 0.06;
        const plateHeight = cy > 0.25 && cy < 0.72;
        const nearCenter = Math.abs(cz) < 0.22;
        if (facingX && nearEnd && plateHeight && nearCenter) plate.push(i0, i1, i2);
        else keep.push(i0, i1, i2);
      }
      if (plate.length === 0) continue;

      // 同じ頂点データを共有したまま、インデックスだけ分けて別マテリアルにする
      const platePrim = doc
        .createPrimitive()
        .setMaterial(plateMat)
        .setIndices(doc.createAccessor().setArray(new Uint32Array(plate)));
      for (const name of prim.listSemantics()) platePrim.setAttribute(name, prim.getAttribute(name));
      mesh.addPrimitive(platePrim);
      idx.setArray(new Uint32Array(keep));
      moved += plate.length / 3;
    }
  }
  console.log(
    moved > 0
      ? `ナンバープレートを別マテリアルにした（${moved} 三角形・色 ${plateColor}）`
      : "ナンバープレートらしい面を見つけられなかった（車体と同じ色のまま）",
  );
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

// --- 3.8) プリミティブごとに頂点データを独立させる -----------------------
// Mapbox の model ローダーは**アクセサを共有した複数プリミティブ**を正しく読めず、
// 「RangeError: offset is out of bounds」で落ちる（2026-08-10 実機で確認）。
// 動いている truck.glb は「1プリミティブ・uint16 インデックス」だったので、それに寄せる:
// プリミティブごとに使う頂点だけを詰め直し、可能なら uint16 にする。
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    if (!idx) continue;
    const semantics = prim.listSemantics();
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
    for (const name of semantics) {
      const attr = prim.getAttribute(name);
      const size = attr.getElementSize();
      const packed = new Float32Array(remap.size * size);
      const el = new Array(size).fill(0);
      for (const [oldIndex, newIndex] of remap) {
        attr.getElement(oldIndex, el);
        packed.set(el, newIndex * size);
      }
      prim.setAttribute(
        name,
        doc.createAccessor().setType(attr.getType()).setArray(packed),
      );
    }
    const Arr = remap.size <= 65535 ? Uint16Array : Uint32Array;
    prim.setIndices(doc.createAccessor().setArray(new Arr(newIndices)));
  }
}
// 参照されなくなったアクセサを掃除する
for (const acc of root.listAccessors()) {
  if (acc.listParents().length <= 1) acc.dispose();
}

await io.write(tmp, doc);

// --- 4) 出力 -------------------------------------------------------------
// ★Draco 圧縮はしない。Mapbox の model レイヤーが読めるか保証が無く、
//   既に動いている truck.glb も非圧縮のため（2026-08-10 に確認）。
await io.write(output, doc);
rmSync(tmp, { force: true });
console.log(`完成: ${output}（${(readFileSync(output).length / 1024).toFixed(0)} KB）`);
console.log("原点=底面中心 / 実寸 / 非圧縮。model-color で着色するため車体は無彩色にしておくこと");
