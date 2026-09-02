#!/usr/bin/env node
// 既存のSVGナンバー字形から車両固有のプレート画像を作り、
// HH5の前後プレート面だけを残した小さなGLBへ直接貼る。
//
// 使い方:
//   node scripts/build-vehicle-plate-model.mjs \
//     <入力HH5.glb> <出力プレート.glb> <地名> <分類番号> <かな> <一連番号>

import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Accessor, NodeIO, PropertyType, VertexLayout } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const [input, output, region, classification, hiragana, serialRaw] = process.argv.slice(2);
if (!input || !output || !region || !classification || !hiragana || !serialRaw) {
  console.error("使い方: node scripts/build-vehicle-plate-model.mjs <入力.glb> <出力.glb> <地名> <分類番号> <かな> <一連番号>");
  process.exit(1);
}

const rootDir = process.cwd();
const assetRoot = path.join(rootDir, "apps/web/public/number_plate");
const plateLayout = JSON.parse(readFileSync(path.join(rootDir, "apps/web/src/lib/vehiclePlateLayout.json"), "utf8"));
const TEXT_COLOR = "#e8d44d";
const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = 256;
const textureScale = TEXTURE_WIDTH / plateLayout.referenceWidth;
const px = (value) => value * textureScale;

function glyphPath(category, character) {
  if (category === "kanji") return path.join(assetRoot, "kanji", `kanji_${character}.svg`);
  if (category === "classification") return path.join(assetRoot, "classification_numbers", `classification_${character}.svg`);
  if (category === "hiragana") return path.join(assetRoot, "hiragana", `${character}.svg`);
  return path.join(assetRoot, "serial_numbers", `serial_numbers_${character}.svg`);
}

async function readTrimmedGlyph(category, character) {
  const source = readFileSync(glyphPath(category, character), "utf8")
    .replace("<svg ", `<svg fill="${TEXT_COLOR}" `);
  const { data, info } = await sharp(Buffer.from(source))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

async function renderGlyph(category, character, referenceHeight, visualScaleY = 1) {
  const trimmed = await readTrimmedGlyph(category, character);
  const categoryScale = px(referenceHeight) / 100;
  const width = Math.max(1, Math.round(trimmed.width * categoryScale));
  const height = Math.max(1, Math.round(trimmed.height * categoryScale * visualScaleY));
  const input = await sharp(trimmed.input).resize({ width, height, fit: "fill" }).png().toBuffer();
  return { input, width, height };
}

async function placeTopRow() {
  const layout = plateLayout.top;
  const regionGlyphs = await Promise.all([...region].map((character) => renderGlyph("kanji", character, layout.glyphHeight)));
  const classGlyphs = await Promise.all([...classification].map((character) => renderGlyph("classification", character, layout.glyphHeight)));
  const classDigits = await Promise.all("0123456789".split("").map(async (character) => {
    try { return await renderGlyph("classification", character, layout.glyphHeight); }
    catch { return null; }
  }));
  const classSlot = Math.max(...classDigits.filter(Boolean).map((glyph) => glyph.width));
  const regionGap = px(layout.regionGap);
  const classGap = px(layout.classificationGap);
  const groupGap = px(layout.groupGap);
  const regionWidth = regionGlyphs.reduce((sum, glyph) => sum + glyph.width, 0) + regionGap * Math.max(0, regionGlyphs.length - 1);
  const classWidth = classSlot * classGlyphs.length + classGap * Math.max(0, classGlyphs.length - 1);
  let left = (TEXTURE_WIDTH - regionWidth - groupGap - classWidth) / 2;
  const top = Math.round(px(layout.top));
  const placements = [];
  for (const glyph of regionGlyphs) {
    placements.push({ input: glyph.input, left: Math.round(left), top });
    left += glyph.width + regionGap;
  }
  left = (TEXTURE_WIDTH - regionWidth - groupGap - classWidth) / 2 + regionWidth + groupGap;
  for (const glyph of classGlyphs) {
    placements.push({ input: glyph.input, left: Math.round(left + (classSlot - glyph.width) / 2), top });
    left += classSlot + classGap;
  }
  return placements;
}

async function placeSerialRow() {
  const layout = plateLayout.bottom;
  const rawDigits = serialRaw.replace(/\D/g, "").slice(0, 4);
  const digits = rawDigits.padStart(4, "・");
  const serial = [digits[0], digits[1], rawDigits.length === 4 ? "-" : null, digits[2], digits[3]];
  const kana = await renderGlyph("hiragana", hiragana, layout.kanaHeight);
  const glyphs = await Promise.all(serial.map((character) => character
    ? renderGlyph("serial", character, layout.serialHeight, character === "-" ? layout.hyphenScaleY : 1)
    : null));
  const digitGlyphs = await Promise.all("0123456789".split("").map((character) => renderGlyph("serial", character, layout.serialHeight)));
  const hyphenGlyph = await renderGlyph("serial", "-", layout.serialHeight, layout.hyphenScaleY);
  const digitSlot = Math.max(...digitGlyphs.map((glyph) => glyph.width));
  const hyphenSlot = hyphenGlyph.width;
  const gap = px(layout.serialGap);
  const slots = glyphs.map((_, index) => index === 2 ? hyphenSlot : digitSlot);
  const kanaGap = px(layout.kanaGap);
  const rowWidth = kana.width + kanaGap + slots.reduce((sum, width) => sum + width, 0) + gap * (slots.length - 1);
  let left = Math.round((TEXTURE_WIDTH - rowWidth) / 2);
  const serialHeight = px(layout.serialHeight);
  const serialTop = TEXTURE_HEIGHT - px(layout.bottom) - serialHeight;
  const placements = [{
    input: kana.input,
    left,
    top: Math.round(serialTop + (serialHeight - kana.height) / 2),
  }];
  left += kana.width + kanaGap;
  glyphs.forEach((glyph, index) => {
    const slot = slots[index];
    if (glyph) {
      placements.push({
        input: glyph.input,
        left: Math.round(left + (slot - glyph.width) / 2),
        top: Math.round(serialTop + (serialHeight - glyph.height) / 2),
      });
    }
    left += slot + gap;
  });
  return placements;
}

const base = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${TEXTURE_WIDTH}" height="${TEXTURE_HEIGHT}" viewBox="0 0 ${TEXTURE_WIDTH} ${TEXTURE_HEIGHT}">
    <rect width="512" height="256" rx="${px(plateLayout.cornerRadius)}" fill="#b8a038"/>
    <rect x="${px(plateLayout.borderWidth)}" y="${px(plateLayout.borderWidth)}" width="${TEXTURE_WIDTH - 2 * px(plateLayout.borderWidth)}" height="${TEXTURE_HEIGHT - 2 * px(plateLayout.borderWidth)}" rx="${px(plateLayout.cornerRadius - plateLayout.borderWidth / 2)}" fill="#000000" stroke="#1a1a1a" stroke-width="${px(plateLayout.insetWidth)}"/>
    <circle cx="${px(plateLayout.bolt.centerX)}" cy="${px(plateLayout.bolt.centerY)}" r="${px(plateLayout.bolt.innerDiameter / 2)}" fill="#282828"/>
    <circle cx="${TEXTURE_WIDTH - px(plateLayout.bolt.centerX)}" cy="${px(plateLayout.bolt.centerY)}" r="${px(plateLayout.bolt.innerDiameter / 2)}" fill="#282828"/>
  </svg>
`);

const texturePng = await sharp(base)
  .composite([
    ...(await placeTopRow()),
    ...(await placeSerialRow()),
  ])
  .png()
  .toBuffer();

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
const doc = await io.read(input);
const root = doc.getRoot();

for (const mesh of root.listMeshes()) {
  for (const primitive of [...mesh.listPrimitives()]) {
    if (primitive.getMaterial()?.getName() !== "License Plate Front") primitive.dispose();
  }
  if (mesh.listPrimitives().length === 0) {
    for (const node of root.listNodes()) if (node.getMesh() === mesh) node.setMesh(null);
    mesh.dispose();
  }
}
for (const material of root.listMaterials()) {
  if (!material.listParents().some((parent) => parent.propertyType === PropertyType.PRIMITIVE)) material.dispose();
}
for (const accessor of root.listAccessors()) {
  if (!accessor.listParents().some((parent) => parent.propertyType !== PropertyType.ROOT)) accessor.dispose();
}

const texture = doc.createTexture(`plate-${region}-${classification}-${hiragana}-${serialRaw}`)
  .setImage(texturePng)
  .setMimeType("image/png");

for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute("POSITION");
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
    primitive.getMaterial()
      .setName(`Plate ${region} ${classification} ${hiragana} ${serialRaw}`)
      .setBaseColorFactor([1, 1, 1, 1])
      .setBaseColorTexture(texture)
      .setMetallicFactor(0)
      .setRoughnessFactor(0.78);
  }
}

await io.write(output, doc);
console.log(`完成: ${output}（${(readFileSync(output).length / 1024).toFixed(0)} KB / SVG字形を前後プレート面へ直接貼付）`);
