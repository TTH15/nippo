/**
 * 車両画像の Storage 移行（data URL → Supabase Storage）。
 *
 * 背景: 従来 vehicles.image_url に data URL（base64）を直接入れていた。
 * 1枚あたり 600KB 前後あり、一覧 API が全車両ぶんを返すため初期表示が重い
 * （実測: 画像込み 1630ms/3777KB → 画像なし 217ms/11KB）。
 * コードは Storage 対応済みだが、既存行は変換されないままなのでここで移す。
 *
 * 冪等: 既に path になっている行はスキップするため、何度実行しても安全。
 *
 * Run:
 *   cd apps/web && npx tsx src/scripts/backfill-vehicle-images.ts          # 確認のみ
 *   cd apps/web && npx tsx src/scripts/backfill-vehicle-images.ts --apply  # 実行
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("[backfill] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
  process.exit(1);
}

const supabase = createClient(url, key);
const BUCKET = "vehicle-images";
const APPLY = process.argv.includes("--apply");

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.*)$/);
  if (!m?.[1] || !m?.[2]) return null;
  return { bytes: new Uint8Array(Buffer.from(m[2], "base64")), mime: m[1] };
}

function extFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

async function main() {
  const { data: rows, error } = await supabase
    .from("vehicles")
    .select("id, owner_org_id, image_url, manufacturer, brand")
    .not("image_url", "is", null);
  if (error) throw new Error(`車両の取得に失敗: ${error.message}`);

  const targets = (rows ?? []).filter((v) => String(v.image_url ?? "").startsWith("data:"));
  const already = (rows ?? []).length - targets.length;

  console.log(`[backfill] 画像あり: ${(rows ?? []).length}件（移行済み ${already} / 対象 ${targets.length}）`);
  if (targets.length === 0) {
    console.log("[backfill] 移行対象はありません。");
    return;
  }

  const totalBytes = targets.reduce((s, v) => s + String(v.image_url).length, 0);
  console.log(`[backfill] 対象の合計サイズ: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

  if (!APPLY) {
    for (const v of targets) {
      const kb = Math.round(String(v.image_url).length / 1024);
      console.log(`  - ${v.manufacturer ?? ""} ${v.brand ?? ""} (${v.id}) ${kb} KB`);
    }
    console.log("\n確認のみで終了しました。実行するには --apply を付けてください。");
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const v of targets) {
    const decoded = decodeDataUrl(String(v.image_url));
    if (!decoded) {
      console.error(`  ✗ ${v.id}: data URL を解釈できませんでした`);
      failed++;
      continue;
    }

    const objectPath = `${v.owner_org_id}/${v.id}.${extFor(decoded.mime)}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(objectPath, decoded.bytes, {
      contentType: decoded.mime,
      upsert: true, // 再実行時に同じパスへ上書き（冪等）
    });
    if (upErr) {
      console.error(`  ✗ ${v.id}: アップロード失敗 ${upErr.message}`);
      failed++;
      continue;
    }

    // アップロードが成功してから DB を差し替える（順序を逆にすると画像を失う）
    const { error: updErr } = await supabase
      .from("vehicles")
      .update({ image_url: objectPath })
      .eq("id", v.id);
    if (updErr) {
      console.error(`  ✗ ${v.id}: DB更新失敗 ${updErr.message}`);
      failed++;
      continue;
    }

    console.log(`  ✓ ${v.manufacturer ?? ""} ${v.brand ?? ""} → ${objectPath}`);
    ok++;
  }

  console.log(`\n[backfill] 完了: 成功 ${ok} / 失敗 ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[backfill] ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
