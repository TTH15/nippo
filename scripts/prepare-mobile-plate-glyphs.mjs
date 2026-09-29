// WebナンバープレートのSVG字形と配置を、RN Imageで使える透過PNGへ展開する。
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root = process.cwd(), target = path.join(root, 'apps/mobile/src/components/plate-assets');
const cache = path.join(root, 'node_modules/.cache/hakotora-plate');
await mkdir(cache, { recursive: true }); await mkdir(target, { recursive: true });
await build({ entryPoints: ['apps/web/src/lib/plateGlyphs.generated.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(cache, 'glyphs.cjs') });
const { PLATE_GLYPHS } = createRequire(import.meta.url)(path.join(cache, 'glyphs.cjs'));
const lines = ['// 自動生成: node scripts/prepare-mobile-plate-glyphs.mjs。WebのSVG字形を再利用。', 'import type { ImageSourcePropType } from "react-native";', 'export const plateGlyphs: Record<string, Record<string, { source: ImageSourcePropType; ratio: number; relativeHeight: number; relativeWidth: number; yOffset: number }>> = {'];
for (const [category, value] of Object.entries(PLATE_GLYPHS)) {
  lines.push(`  ${category}: {`);
  for (const [char, meta] of Object.entries(value.glyphs)) {
    const name = `${category}-${char.codePointAt(0).toString(16)}.png`;
    const input = path.join(root, 'apps/web/public', decodeURIComponent(meta.src));
    const { data, info } = await sharp(await readFile(input)).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
    await writeFile(path.join(target, name), data);
    lines.push(`    ${JSON.stringify(char)}: { source: require("./${name}"), ratio: ${info.width / info.height}, relativeHeight: ${meta.h/value.refH}, relativeWidth: ${meta.w/value.refH}, yOffset: ${(meta.y-value.minY)/value.refH} },`);
  }
  lines.push('  },');
}
lines.push('};');
await writeFile(path.join(target, 'glyphs.ts'), lines.join('\n') + '\n');
await writeFile(path.join(target, 'layout.json'), await readFile(path.join(root, 'apps/web/src/lib/vehiclePlateLayout.json')));
console.log('Web SVG glyphs and layout prepared');
