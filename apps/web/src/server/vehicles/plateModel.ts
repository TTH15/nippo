// ============================================================
// 車両1台ぶんのナンバープレート GLB をサーバーで作る。
//
// 地図の3Dの車には前後のプレート面がある。Mapbox はモデル名で3Dを選ぶので、
// 車ごとに違う番号を出すには「その番号を焼いた小さな GLB」が1台につき1つ要る。
// 車両を登録・番号を変更したときに裏で作り、非公開バケットへ置く（2026-09-09 ユーザー依頼）。
//
// 幾何と UV は車種ごとの「無地の型」（plate-blanks/*.glb・scripts/build-plate-blank.mjs で
// 作る）に用意済みで、ここでやるのは番号のテクスチャを描いて貼るところだけ。
// 元の車種モデルは 474〜754KB あって関数へ同梱するには重いが、型なら 21〜37KB で済む。
// ============================================================

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NodeIO, VertexLayout } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import plateLayout from "@/lib/vehiclePlateLayout.json";

export type PlateText = {
  region: string;
  classification: string;
  hiragana: string;
  serial: string;
};

const TEXT_COLOR = "#e8d44d";
const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = 256;
const textureScale = TEXTURE_WIDTH / plateLayout.referenceWidth;
const px = (value: number) => value * textureScale;

const assetRoot = () => path.join(process.cwd(), "public", "number_plate");
const blankPath = (modelId: string) =>
  path.join(process.cwd(), "src", "server", "vehicles", "plate-blanks", `${modelId}.glb`);

function glyphPath(category: string, character: string): string {
  const root = assetRoot();
  if (category === "kanji") return path.join(root, "kanji", `kanji_${character}.svg`);
  if (category === "classification") return path.join(root, "classification_numbers", `classification_${character}.svg`);
  if (category === "hiragana") return path.join(root, "hiragana", `${character}.svg`);
  return path.join(root, "serial_numbers", `serial_numbers_${character}.svg`);
}

type Glyph = { input: Buffer; width: number; height: number };

async function readTrimmedGlyph(category: string, character: string): Promise<Glyph> {
  const source = (await readFile(glyphPath(category, character), "utf8")).replace("<svg ", `<svg fill="${TEXT_COLOR}" `);
  const { data, info } = await sharp(Buffer.from(source))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

async function renderGlyph(category: string, character: string, referenceHeight: number, visualScaleY = 1): Promise<Glyph> {
  const trimmed = await readTrimmedGlyph(category, character);
  const categoryScale = px(referenceHeight) / 100;
  const width = Math.max(1, Math.round(trimmed.width * categoryScale));
  const height = Math.max(1, Math.round(trimmed.height * categoryScale * visualScaleY));
  const input = await sharp(trimmed.input).resize({ width, height, fit: "fill" }).png().toBuffer();
  return { input, width, height };
}

type Placement = { input: Buffer; left: number; top: number };

async function placeTopRow(plate: PlateText): Promise<Placement[]> {
  const layout = plateLayout.top;
  const regionGlyphs = await Promise.all([...plate.region].map((c) => renderGlyph("kanji", c, layout.glyphHeight)));
  const classGlyphs = await Promise.all([...plate.classification].map((c) => renderGlyph("classification", c, layout.glyphHeight)));
  const classDigits = await Promise.all(
    "0123456789".split("").map(async (c) => {
      try {
        return await renderGlyph("classification", c, layout.glyphHeight);
      } catch {
        return null;
      }
    }),
  );
  const classSlot = Math.max(...classDigits.filter((g): g is Glyph => !!g).map((g) => g.width));
  const regionGap = px(layout.regionGap);
  const classGap = px(layout.classificationGap);
  const groupGap = px(layout.groupGap);
  const regionWidth = regionGlyphs.reduce((sum, g) => sum + g.width, 0) + regionGap * Math.max(0, regionGlyphs.length - 1);
  const classWidth = classSlot * classGlyphs.length + classGap * Math.max(0, classGlyphs.length - 1);
  const startLeft = (TEXTURE_WIDTH - regionWidth - groupGap - classWidth) / 2;
  const top = Math.round(px(layout.top));
  const placements: Placement[] = [];
  let left = startLeft;
  for (const glyph of regionGlyphs) {
    placements.push({ input: glyph.input, left: Math.round(left), top });
    left += glyph.width + regionGap;
  }
  left = startLeft + regionWidth + groupGap;
  for (const glyph of classGlyphs) {
    placements.push({ input: glyph.input, left: Math.round(left + (classSlot - glyph.width) / 2), top });
    left += classSlot + classGap;
  }
  return placements;
}

async function placeSerialRow(plate: PlateText): Promise<Placement[]> {
  const layout = plateLayout.bottom;
  const rawDigits = plate.serial.replace(/\D/g, "").slice(0, 4);
  const digits = rawDigits.padStart(4, "・");
  const serial = [digits[0], digits[1], rawDigits.length === 4 ? "-" : null, digits[2], digits[3]];
  const kana = await renderGlyph("hiragana", plate.hiragana, layout.kanaHeight);
  const glyphs = await Promise.all(
    serial.map((c) => (c ? renderGlyph("serial", c, layout.serialHeight, c === "-" ? layout.hyphenScaleY : 1) : null)),
  );
  const digitGlyphs = await Promise.all("0123456789".split("").map((c) => renderGlyph("serial", c, layout.serialHeight)));
  const hyphenGlyph = await renderGlyph("serial", "-", layout.serialHeight, layout.hyphenScaleY);
  const digitSlot = Math.max(...digitGlyphs.map((g) => g.width));
  const gap = px(layout.serialGap);
  const slots = glyphs.map((_, index) => (index === 2 ? hyphenGlyph.width : digitSlot));
  const kanaGap = px(layout.kanaGap);
  const rowWidth = kana.width + kanaGap + slots.reduce((sum, w) => sum + w, 0) + gap * (slots.length - 1);
  let left = Math.round((TEXTURE_WIDTH - rowWidth) / 2);
  const serialHeight = px(layout.serialHeight);
  const serialTop = TEXTURE_HEIGHT - px(layout.bottom) - serialHeight;
  const placements: Placement[] = [
    { input: kana.input, left, top: Math.round(serialTop + (serialHeight - kana.height) / 2) },
  ];
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

/** 番号を焼いた 512×256 のプレート画像（PNG） */
export async function renderPlateTexture(plate: PlateText): Promise<Buffer> {
  const base = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${TEXTURE_WIDTH}" height="${TEXTURE_HEIGHT}" viewBox="0 0 ${TEXTURE_WIDTH} ${TEXTURE_HEIGHT}">
      <rect width="512" height="256" rx="${px(plateLayout.cornerRadius)}" fill="#b8a038"/>
      <rect x="${px(plateLayout.borderWidth)}" y="${px(plateLayout.borderWidth)}" width="${TEXTURE_WIDTH - 2 * px(plateLayout.borderWidth)}" height="${TEXTURE_HEIGHT - 2 * px(plateLayout.borderWidth)}" rx="${px(plateLayout.cornerRadius - plateLayout.borderWidth / 2)}" fill="#000000" stroke="#1a1a1a" stroke-width="${px(plateLayout.insetWidth)}"/>
      <circle cx="${px(plateLayout.bolt.centerX)}" cy="${px(plateLayout.bolt.centerY)}" r="${px(plateLayout.bolt.innerDiameter / 2)}" fill="#282828"/>
      <circle cx="${TEXTURE_WIDTH - px(plateLayout.bolt.centerX)}" cy="${px(plateLayout.bolt.centerY)}" r="${px(plateLayout.bolt.innerDiameter / 2)}" fill="#282828"/>
    </svg>
  `);
  return sharp(base)
    .composite([...(await placeTopRow(plate)), ...(await placeSerialRow(plate))])
    .png()
    .toBuffer();
}

/** 車種の無地の型に番号のテクスチャを貼った GLB */
export async function buildPlateGlb(modelId: string, plate: PlateText): Promise<Uint8Array> {
  const [blank, texturePng] = await Promise.all([readFile(blankPath(modelId)), renderPlateTexture(plate)]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
  const doc = await io.readBinary(new Uint8Array(blank));
  const texture = doc
    .createTexture(`plate-${plate.region}-${plate.classification}-${plate.hiragana}-${plate.serial}`)
    .setImage(new Uint8Array(texturePng))
    .setMimeType("image/png");
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitive
        .getMaterial()
        ?.setName(`Plate ${plate.region} ${plate.classification} ${plate.hiragana} ${plate.serial}`)
        .setBaseColorFactor([1, 1, 1, 1])
        .setBaseColorTexture(texture)
        .setMetallicFactor(0)
        .setRoughnessFactor(0.78);
    }
  }
  return io.writeBinary(doc);
}

/** 番号が揃っていない車は作らない（作っても読めないプレートになるだけ） */
export function plateTextOf(vehicle: {
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
}): PlateText | null {
  const region = (vehicle.number_prefix ?? "").trim();
  const classification = (vehicle.number_class ?? "").trim();
  const hiragana = (vehicle.number_hiragana ?? "").trim();
  const serial = (vehicle.number_numeric ?? "").replace(/\D/g, "");
  if (!region || !classification || !hiragana || !serial) return null;
  return { region, classification, hiragana, serial };
}
