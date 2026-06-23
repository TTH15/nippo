import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// 本登録（KYC）の免許証・顔写真（Supabase Storage・非公開バケット）入出力。
// サーバ専用（service-role クライアント前提）。雛形: server/reportKinds/attachments.ts
// ============================================================

export const KYC_BUCKET = "kyc-documents";

const ACCEPT_MIME = ["image/jpeg", "image/png"];
const MAX_BYTES = 8 * 1024 * 1024; // 8MB

export type KycKind = "license" | "face";

export function checkImage(mime: string, size: number): { ok: true } | { ok: false; message: string } {
  if (!ACCEPT_MIME.includes(mime)) {
    return { ok: false, message: "対応していない画像形式です（JPEG / PNG のみ）。" };
  }
  if (size > MAX_BYTES) {
    return { ok: false, message: `画像サイズは ${Math.floor(MAX_BYTES / (1024 * 1024))}MB 以下にしてください。` };
  }
  return { ok: true };
}

/** KYC 画像を Storage へアップロードし、保存パスを返す（identity 単位・kind ごとに上書き）。 */
export async function uploadKycImage(
  supabase: SupabaseClient,
  identityId: string,
  kind: KycKind,
  file: { bytes: ArrayBuffer | Uint8Array; mime: string },
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const ext = file.mime === "image/png" ? "png" : "jpg";
  const path = `${identityId}/${kind}.${ext}`;
  const { error } = await supabase.storage.from(KYC_BUCKET).upload(path, file.bytes, {
    contentType: file.mime,
    upsert: true,
  });
  if (error) {
    console.error("[kyc/storage] upload error", error);
    return { ok: false, message: "アップロードに失敗しました（バケット未作成の可能性）。" };
  }
  return { ok: true, path };
}

/** KYC 画像に短時間の署名URLを付与（承認後の org 閲覧用・将来）。 */
export async function signKyc(
  supabase: SupabaseClient,
  path: string,
  expiresInSec = 60 * 10,
): Promise<string | null> {
  const { data } = await supabase.storage.from(KYC_BUCKET).createSignedUrl(path, expiresInSec);
  return data?.signedUrl ?? null;
}
