import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyFileContent } from "@/server/storage/fileSignature";
import { randomBytes } from "crypto";

// ============================================================
// メーター写真（Supabase Storage・非公開バケット）入出力。サーバ専用（service-role）。
// 雛形: server/kyc/storage.ts
// ============================================================

export const METER_BUCKET = "meter-photos";

/** メーター写真をアップロードし保存パスを返す（org/driver 単位・毎回ユニーク名）。 */
export async function uploadMeterPhoto(
  supabase: SupabaseClient,
  ctx: { orgId: string; driverId: string },
  file: { bytes: ArrayBuffer | Uint8Array; mime: string },
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  // 申告 MIME は偽装できるため、中身（マジックバイト）で検証する
  const verified = verifyFileContent(new Uint8Array(file.bytes as ArrayBuffer), ["image/jpeg", "image/png"], file.mime);
  if (!verified.ok) return { ok: false, message: verified.message };
  const ext = file.mime === "image/png" ? "png" : "jpg";
  const path = `${ctx.orgId}/${ctx.driverId}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  const { error } = await supabase.storage.from(METER_BUCKET).upload(path, file.bytes, {
    contentType: file.mime,
    upsert: false,
  });
  if (error) {
    console.error("[meterStorage] upload error", error);
    return { ok: false, message: "メーター写真のアップロードに失敗しました（バケット未作成の可能性）。" };
  }
  return { ok: true, path };
}

/** メーター写真の短時間署名URL（運営の勤怠照合用）。 */
export async function signMeterPhoto(
  supabase: SupabaseClient,
  path: string,
  expiresInSec = 60 * 10,
): Promise<string | null> {
  const { data } = await supabase.storage.from(METER_BUCKET).createSignedUrl(path, expiresInSec);
  return data?.signedUrl ?? null;
}
