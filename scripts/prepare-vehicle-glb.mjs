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
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [
  input,
  output,
  lengthMStr = "3.4",
  targetTriStr = "16000",
  texSizeStr = "1024",
  style = "masked", // 既定。窓・タイヤが暗いまま残り、車体だけ着色できる
  plateColor = "#111827", // 事業用（黒ナンバー）。自家用なら白系を渡す
  plateMode = "auto", // auto=幾何条件で自動切り出し / none=切り出さない（Blender で分ける場合）
  // 既定は none。テクスチャの明度で窓・タイヤを分ける試みは**アトラスの構造上うまくいかない**
  // （2026-08-11 検証。下のコメント参照）。試したい場合だけ auto を渡す
  darkSplit = "none",
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
const DARK_LUMA = 0.2;
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
// masked（推奨）: テクスチャを**白黒の「塗り分けマスク」**に変換して残す。
//   窓・タイヤは暗いまま、車体は白。three.js は material.color がテクスチャと**乗算**されるので、
//   車体だけが指定色になり窓は暗いまま保たれる。**面の選択作業が要らない**のが最大の利点
//   （スマートトポロジー版は窓が「描いてあるだけ」で形状が無く、面では選べないため）
// flat: テクスチャを外し、無彩色のフラットな見た目にする（軽いが窓も同色になる）
// photo: テクスチャをそのまま残す（実物に寄せたいとき）
if (style === "masked") {
  // base_color を「塗り分けマスク」に変換する。
  // 明るいところ（車体）を白に寄せ、暗いところ（窓・タイヤ・グリル）は暗いまま残す。
  const baseTex = root
    .listMaterials()
    .map((m) => m.getBaseColorTexture())
    .find(Boolean);
  if (baseTex) {
    const src = sharp(Buffer.from(baseTex.getImage())).removeAlpha();
    const { data, info } = await src
      .resize(texSize, texSize, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 255;
      // 窓・タイヤ（アトラス上でおよそ 0.15〜0.30）を確実に暗く残し、車体（0.6〜0.9）を白へ持ち上げる。
      // 中間を広く取ると窓が塗られてしまうので、しきい値をはさんで一気に立ち上げる
      const mapped = Math.min(1, Math.max(0, (v - 0.34) / 0.34)) * 0.92 + (v < 0.34 ? v * 0.25 : 0.08);
      out[i] = Math.round(mapped * 255);
    }
    const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } })
      .toColourspace("srgb")
      .png({ compressionLevel: 9 })
      .toBuffer();
    baseTex.setImage(png).setMimeType("image/png");
    for (const mat of root.listMaterials()) {
      mat.setMetallicRoughnessTexture(null);
      mat.setNormalTexture(null);
      mat.setOcclusionTexture(null);
      mat.setEmissiveTexture(null);
      mat.setBaseColorFactor([1, 1, 1, 1]); // 色は描画側で掛ける
      mat.setMetallicFactor(0);
      mat.setRoughnessFactor(0.7);
    }
    // 接線は法線マップを外したので不要
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const t = prim.getAttribute("TANGENT");
        if (t) {
          prim.setAttribute("TANGENT", null);
          t.dispose();
        }
      }
    }
    console.log("テクスチャを塗り分けマスク（白黒）に変換した（style=masked）");
  }
} else if (style === "flat") {
  // --- 窓・タイヤ・グリルを別マテリアルにする -----------------------------
  // テクスチャを捨てるとガラスまで車体色になり、粘土のように見える。
  // 捨てる前に base_color の明度で「暗い部分」を判定して分けておく。
  //
  // ★結論: この方法は使えない（2026-08-11 に atlas を書き出して確認）。
  //   Meshy の UV は**細かく分割された島**が並び、島と島の間は**濃いグレーの余白**で埋まっている。
  //   島が小さいため、三角形の内側をサンプルしても余白を拾い、車体に黒い斑が散る。
  //   スマートトポロジー版でも同じだった（13,098三角形でも島は細かい）。
  //   → **窓・タイヤの分離は Blender で手作業**（docs/design/vehicle-3d-blender.md）。
  if (darkSplit !== "none") {
    const baseTex = root
      .listMaterials()
      .map((m) => m.getBaseColorTexture())
      .find(Boolean);
    const hasUv = root
      .listMeshes()
      .some((m) => m.listPrimitives().some((pr) => pr.getAttribute("TEXCOORD_0")));
    if (baseTex && hasUv) {
      const { data, info } = await sharp(Buffer.from(baseTex.getImage()))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const lumaAt = (u, v) => {
        const wrap = (t) => t - Math.floor(t); // UV は 0-1 の外に出ることがある
        const x = Math.min(info.width - 1, Math.floor(wrap(u) * info.width));
        const y = Math.min(info.height - 1, Math.floor((1 - wrap(v)) * info.height)); // glTF の V は上下反転
        const i = (y * info.width + x) * info.channels;
        return (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      };

      const darkMat = doc
        .createMaterial("dark")
        .setBaseColorFactor([0.05, 0.055, 0.065, 1])
        .setMetallicFactor(0.1)
        .setRoughnessFactor(0.35);

      let darkTris = 0;
      let total = 0;
      for (const mesh of root.listMeshes()) {
        for (const prim of [...mesh.listPrimitives()]) {
          const uv = prim.getAttribute("TEXCOORD_0");
          const idx = prim.getIndices();
          if (!uv || !idx) continue;
          const light = [];
          const dark = [];
          const a = [0, 0];
          const b = [0, 0];
          const c = [0, 0];
          for (let t = 0; t < idx.getCount() / 3; t++) {
            const i0 = idx.getScalar(t * 3);
            const i1 = idx.getScalar(t * 3 + 1);
            const i2 = idx.getScalar(t * 3 + 2);
            uv.getElement(i0, a);
            uv.getElement(i1, b);
            uv.getElement(i2, c);
            // ★頂点の UV は島の縁にあり、アトラスの余白（黒）を拾ってしまう。
            //   三角形の内側（重心寄り）を数点サンプルして中央値で判定する
            const samples = [
              [1 / 3, 1 / 3, 1 / 3],
              [0.6, 0.2, 0.2],
              [0.2, 0.6, 0.2],
              [0.2, 0.2, 0.6],
            ].map(([w0, w1, w2]) =>
              lumaAt(a[0] * w0 + b[0] * w1 + c[0] * w2, a[1] * w0 + b[1] * w1 + c[1] * w2),
            );
            samples.sort((x, y) => x - y);
            const dk = (samples[1] + samples[2]) / 2 < DARK_LUMA;
            if (dk) dark.push(i0, i1, i2);
            else light.push(i0, i1, i2);
            total++;
          }
          if (dark.length === 0) continue;
          const darkPrim = doc
            .createPrimitive()
            .setMaterial(darkMat)
            .setIndices(doc.createAccessor().setArray(new Uint32Array(dark)));
          for (const name of prim.listSemantics()) darkPrim.setAttribute(name, prim.getAttribute(name));
          mesh.addPrimitive(darkPrim);
          idx.setArray(new Uint32Array(light));
          darkTris += dark.length / 3;
        }
      }
      const ratio2 = total ? darkTris / total : 0;
      console.log(`窓・タイヤ等を別マテリアルにした（${darkTris} / ${total} 三角形・${(ratio2 * 100).toFixed(0)}%）`);
      if (ratio2 > 0.45) {
        console.log("  ※ 半分近くが暗色。UV が乱れている可能性がある（darkSplit=none を検討）");
      }
    }
  }
  for (const mat of root.listMaterials()) {
    // 分けたマテリアル（glass / dark / plate）は色を保つ。
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
