import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

// ============================================================
// 車両点検写真（前後左右4方向・Supabase Storage・非公開バケット）入出力。サーバ専用（service-role）。
// 雛形: server/vehicleQr/meterStorage.ts
// ============================================================

export const INSPECTION_BUCKET = "vehicle-inspection-photos";

/** 点検写真をアップロードし保存パスを返す（org/driver 単位・毎回ユニーク名）。 */
export async function uploadInspectionPhoto(
  supabase: SupabaseClient,
  ctx: { orgId: string; driverId: string },
  file: { bytes: ArrayBuffer | Uint8Array; mime: string },
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const ext = file.mime === "image/png" ? "png" : "jpg";
  const path = `${ctx.orgId}/${ctx.driverId}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const { error } = await supabase.storage.from(INSPECTION_BUCKET).upload(path, file.bytes, {
    contentType: file.mime,
    upsert: false,
  });
  if (error) {
    console.error("[inspectionStorage] upload error", error);
    return { ok: false, message: "点検写真のアップロードに失敗しました（バケット未作成の可能性）。" };
  }
  return { ok: true, path };
}

/** 点検写真の短時間署名URL（運営の点検照合用）。 */
export async function signInspectionPhoto(
  supabase: SupabaseClient,
  path: string,
  expiresInSec = 60 * 10,
): Promise<string | null> {
  const { data } = await supabase.storage.from(INSPECTION_BUCKET).createSignedUrl(path, expiresInSec);
  return data?.signedUrl ?? null;
}
