// インストール済みの固定版から、ブラウザ内の読取に必要なファイルだけを自社配信する。
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, copyFile, readdir, writeFile } from "node:fs/promises";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "apps/web/package.json"));
const target = path.join(root, "apps/web/public/ocr/runtime");
const copied = [];
async function copy(source, relative) {
  const dest = path.join(target, relative);
  await mkdir(path.dirname(dest), { recursive: true }); await copyFile(source, dest); copied.push(`ocr/runtime/${relative}`);
}
const tess = path.dirname(require.resolve("tesseract.js/package.json"));
const core = path.dirname(require.resolve("tesseract.js-core/package.json"));
const pdf = path.dirname(require.resolve("pdfjs-dist/package.json"));
await copy(path.join(tess, "dist/worker.min.js"), "tesseract/worker.min.js");
for (const file of await readdir(core)) if (file.endsWith(".wasm.js")) await copy(path.join(core, file), `tesseract/${file}`);
await copy(path.join(pdf, "legacy/build/pdf.worker.min.mjs"), "pdf/pdf.worker.min.mjs");
for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
  for (const file of await readdir(path.join(pdf, dir))) await copy(path.join(pdf, dir, file), `pdf/${dir}/${file}`);
}
for (const [source, name] of [[tess, "tesseract"], [core, "tesseract-core"], [pdf, "pdfjs"]]) {
  const license = (await readdir(source)).find(file => /^license/i.test(file));
  if (license) await copy(path.join(source, license), `${name}-LICENSE`);
}
await writeFile(path.join(target, "assets.json"), JSON.stringify(copied));
console.log(`車検証読取の公開ファイル: ${copied.length}件（写真の外部送信なし）`);
