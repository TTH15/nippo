// ============================================================
// 車両画像の保存（Supabase Storage・非公開バケット）。
// 従来は data URL（base64）を vehicles.image_url に直接入れていたため、
// 1枚数MBの文字列が保存のたびに往復し、一覧APIにも全車両ぶん載っていた。
//
// 既存データ（data URL のまま）も表示できるよう、読み出しは
// resolveStoredUrl が data URL / path の両方を吸収する。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadDataUrl, resolveStoredUrl, removeStoredPaths } from "@/server/storage/dataUrl";

export const VEHICLE_IMAGE_BUCKET = "vehicle-images";

/** 保存用。data URL なら Storage へ上げてパスを返す（path ならそのまま）。 */
export async function storeVehicleImage(
  supabase: SupabaseClient,
  orgId: string,
  value: string | null,
): Promise<{ ok: true; path: string | null } | { ok: false; message: string }> {
  if (!value) return { ok: true, path: null };
  const res = await uploadDataUrl(supabase, VEHICLE_IMAGE_BUCKET, orgId, value);
  return res.ok ? { ok: true, path: res.path } : res;
}

/** 表示用 URL に解決する。 */
export function signVehicleImage(
  supabase: SupabaseClient,
  value: string | null | undefined,
): Promise<string | null> {
  return resolveStoredUrl(supabase, VEHICLE_IMAGE_BUCKET, value);
}

/** 差し替え・削除時に古いオブジェクトを消す。 */
export function removeVehicleImages(
  supabase: SupabaseClient,
  values: (string | null | undefined)[],
): Promise<void> {
  return removeStoredPaths(supabase, VEHICLE_IMAGE_BUCKET, values);
}
