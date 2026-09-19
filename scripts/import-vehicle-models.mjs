#!/usr/bin/env node
// 制作台帳から選んだ版だけを取り込む。原本は変更しない。
import { readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

const sourceRoot = process.argv[2];
if (!sourceRoot) throw new Error("制作元ディレクトリを指定してください");
const catalog = JSON.parse(readFileSync("apps/web/src/lib/vehicleModelAssets.json", "utf8"));
mkdirSync("apps/web/src/server/vehicles/plate-blanks", { recursive: true });
for (const asset of catalog) {
  const input = path.join(sourceRoot, asset.sourceDirectory, "model", asset.sourceFile);
  if (createHash("sha256").update(readFileSync(input)).digest("hex") !== asset.sourceSha256) {
    throw new Error(`${asset.key}: 原本のハッシュが台帳と一致しません`);
  }
  const output = `apps/web/public/models/${asset.id}`;
  for (const args of [
    ["scripts/finish-glb-for-mapbox.mjs", input, `${output}.glb`, ...(asset.fixedPaintMaterials ?? []).map(name => `--fixed-paint=${name}`)],
    ["scripts/split-vehicle-map-model.mjs", `${output}.glb`, `${output}-tinted.glb`, `${output}-fixed.glb`, `${output}-lamps.glb`, "--drop-plates", "--paint-parts"],
    ["scripts/build-plate-blank.mjs", `${output}.glb`, `apps/web/src/server/vehicles/plate-blanks/${asset.id}.glb`],
  ]) execFileSync(process.execPath, args, { stdio: "pipe" });
  console.log(`${asset.label}: ${asset.id}`);
}
