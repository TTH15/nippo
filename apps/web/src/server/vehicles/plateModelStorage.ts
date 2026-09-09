import type { SupabaseClient } from "@supabase/supabase-js";
import { mapModelKeyForVehicle, vehicleMapModelFor } from "@/lib/vehicleModels";

// ============================================================
// 車両ごとのナンバープレート GLB を非公開バケットへ置く／署名URLで配る。サーバ専用（service-role）。
// 雛形: server/vehicleQr/inspectionStorage.ts
//
// 実在のナンバーが入るファイルなので、公開リポジトリ（apps/web/public）には置かない。
// 車種モデル本体は全社共通なので従来どおり public のまま（番号は入っていない）。
// ============================================================

export const PLATE_MODEL_BUCKET = "vehicle-plate-models";

// 生成側（sharp と gltf-transform）は読み込むだけで重く、ネイティブ依存もある。
// 署名URLを配るだけの経路（地図API）へ道連れにしないよう、生成のときだけ動的に読む。
// これを静的 import にしていたため、地図APIが sharp の読み込み失敗で 500 になった（2026-09-09）。
const loadBuilder = () => import("@/server/vehicles/plateModel");

/** 保存パス。番号を変えたら中身を差し替える（1台1ファイル） */
const plateModelPath = (orgId: string, vehicleId: string) => `${orgId}/${vehicleId}.glb`;

type PlateVehicle = {
  id: string;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  model_key?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
};

/**
 * 1台ぶんの GLB を作って置く。番号が揃っていない車は作らない（読めないプレートになるだけ）。
 * 呼び出し側の応答は待たせない想定（after() の中で呼ぶ）。
 */
export async function syncPlateModel(
  supabase: SupabaseClient,
  orgId: string,
  vehicle: PlateVehicle,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const model = vehicleMapModelFor(mapModelKeyForVehicle(vehicle));

  let glb: Uint8Array;
  try {
    const { buildPlateGlb, plateTextOf } = await loadBuilder();
    const plate = plateTextOf(vehicle);
    if (!plate) return { ok: false, reason: "番号が揃っていない" };
    glb = await buildPlateGlb(model.id, plate);
  } catch (e) {
    console.error("[plateModel] build error", vehicle.id, e);
    return { ok: false, reason: "生成に失敗" };
  }

  const path = plateModelPath(orgId, vehicle.id);
  const { error } = await supabase.storage.from(PLATE_MODEL_BUCKET).upload(path, glb, {
    contentType: "model/gltf-binary",
    upsert: true,
  });
  if (error) {
    console.error("[plateModel] upload error", path, error);
    return { ok: false, reason: "保存に失敗（バケット未作成の可能性）" };
  }
  return { ok: true, path };
}

/** 車を消したときの後始末。失敗しても本処理は止めない */
export async function removePlateModel(supabase: SupabaseClient, orgId: string, vehicleId: string): Promise<void> {
  const { error } = await supabase.storage.from(PLATE_MODEL_BUCKET).remove([plateModelPath(orgId, vehicleId)]);
  if (error) console.error("[plateModel] remove error", vehicleId, error);
}

/**
 * 地図へ渡す署名URL。1台ずつ発行すると台数ぶん往復するので一括で取る。
 * 置かれていない車（番号が未入力・まだ生成していない）は含めない。
 */
export async function signPlateModels(
  supabase: SupabaseClient,
  orgId: string,
  vehicleIds: readonly string[],
  expiresInSec = 60 * 60,
): Promise<Record<string, string>> {
  if (vehicleIds.length === 0) return {};
  const paths = vehicleIds.map((id) => plateModelPath(orgId, id));
  const { data, error } = await supabase.storage.from(PLATE_MODEL_BUCKET).createSignedUrls(paths, expiresInSec);
  if (error) {
    // バケット未作成でも地図は動かす（プレートが既定のまま出るだけ）
    console.error("[plateModel] sign error", error);
    return {};
  }
  const byVehicle: Record<string, string> = {};
  (data ?? []).forEach((item, index) => {
    if (item.signedUrl && !item.error) byVehicle[vehicleIds[index]] = item.signedUrl;
  });
  return byVehicle;
}
