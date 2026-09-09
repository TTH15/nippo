// ============================================================
// 既存の車両ぶんのナンバープレート GLB をまとめて作り、非公開バケットへ置く。
//
// 車両の登録・更新では API が after() で自動生成するが、既に登録済みの車には
// まだファイルが無い。最初の1回だけこれを流す（2026-09-09）。
//
//   cd apps/web
//   npx tsx src/scripts/backfill-plate-models.ts            # 何を作るか出すだけ
//   npx tsx src/scripts/backfill-plate-models.ts --apply    # 実際に作って置く
//
// 読むのは vehicles だけ。DB は書き換えない（Storage にだけ置く）。
// ============================================================

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";
import { PLATE_MODEL_BUCKET, syncPlateModel } from "../server/vehicles/plateModelStorage";
import { plateTextOf } from "../server/vehicles/plateModel";
import { mapModelKeyForVehicle, vehicleMapModelFor } from "../lib/vehicleModels";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const apply = process.argv.includes("--apply");
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function ensureBucket(): Promise<void> {
  const { data } = await supabase.storage.getBucket(PLATE_MODEL_BUCKET);
  if (data) {
    console.log(`バケット ${PLATE_MODEL_BUCKET}: あり（public=${data.public}）`);
    return;
  }
  if (!apply) {
    console.log(`バケット ${PLATE_MODEL_BUCKET}: 未作成（--apply で非公開バケットとして作ります）`);
    return;
  }
  const { error } = await supabase.storage.createBucket(PLATE_MODEL_BUCKET, {
    public: false,
    fileSizeLimit: 1024 * 1024,
    allowedMimeTypes: ["model/gltf-binary", "application/octet-stream"],
  });
  if (error) throw error;
  console.log(`バケット ${PLATE_MODEL_BUCKET}: 作成しました（非公開）`);
}

async function main() {
  console.log(`\n=== ナンバープレート GLB の一括生成 ${apply ? "(適用)" : "(確認のみ)"} ===\n`);
  await ensureBucket();

  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, owner_org_id, number_prefix, number_class, number_hiragana, number_numeric, model_key, manufacturer, brand")
    .eq("is_disposed", false)
    .order("number_numeric", { ascending: true });
  if (error) throw error;

  let made = 0;
  let skipped = 0;
  for (const v of vehicles ?? []) {
    const plate = plateTextOf(v);
    const model = vehicleMapModelFor(mapModelKeyForVehicle(v));
    const label = plate
      ? `${plate.region} ${plate.classification} ${plate.hiragana} ${plate.serial}`
      : "（番号が未入力）";
    if (!plate) {
      console.log(`  - ${label} … 作らない`);
      skipped += 1;
      continue;
    }
    if (!apply) {
      console.log(`  - ${label} … ${model.id} で作る`);
      made += 1;
      continue;
    }
    const result = await syncPlateModel(supabase, String(v.owner_org_id), v);
    if (result.ok) {
      console.log(`  ✓ ${label} → ${result.path}`);
      made += 1;
    } else {
      console.log(`  ✗ ${label} … ${result.reason}`);
      skipped += 1;
    }
  }

  console.log(`\n${apply ? "作成" : "対象"}: ${made} 台 / 対象外: ${skipped} 台`);
  if (!apply) console.log("実際に作るには --apply を付けて実行してください。\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
