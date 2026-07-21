// ============================================================
// data URL（base64）→ Storage への移行を支える共通ヘルパー。
//
// 経緯: 車両画像・請求書添付は data URL のまま DB に保存していたため、
//   ・保存のたびに数MBの文字列を送受信する（「保存中」が長い）
//   ・一覧 API が全件ぶんの画像/添付を返す（初期表示が重い）
//   という問題があった。KYC・メーター写真・諸報告と同じく Storage に寄せる。
//
// 既存データ（data URL のまま DB にある行）も読めるよう、
// 「値が data URL ならそのまま返す／path なら署名URLにする」という
// 二重解決を用意して段階移行できるようにする。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";

export type DecodedDataUrl = { bytes: Uint8Array; mime: string; bytesLength: number };

/** data URL 形式かどうか（既存データとの判別に使う）。 */
export function isDataUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("data:");
}

/** data URL をバイト列へ復元する。形式不正なら null。 */
export function decodeDataUrl(dataUrl: string): DecodedDataUrl | null {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.*)$/);
  if (!m?.[1] || !m?.[2]) return null;
  const mime = m[1];
  const buffer = Buffer.from(m[2], "base64");
  return { bytes: new Uint8Array(buffer), mime, bytesLength: buffer.byteLength };
}

/** 拡張子を MIME から決める（Storage のパス用）。 */
export function extensionForMime(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/**
 * data URL を Storage へ上げてパスを返す。
 * 既に path（data URL でない）ならアップロードせずそのまま返す＝再保存で二重にしない。
 */
export async function uploadDataUrl(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string,
  value: string,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (!isDataUrl(value)) return { ok: true, path: value };

  const decoded = decodeDataUrl(value);
  if (!decoded) return { ok: false, message: "ファイル形式を認識できませんでした。" };

  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${prefix}/${rand}.${extensionForMime(decoded.mime)}`;

  const { error } = await supabase.storage.from(bucket).upload(path, decoded.bytes, {
    contentType: decoded.mime,
    upsert: false,
  });
  if (error) {
    console.error(`[storage/${bucket}] upload error`, error);
    return { ok: false, message: "アップロードに失敗しました（バケット未作成の可能性）。" };
  }
  return { ok: true, path };
}

/**
 * 保存値を表示用 URL に解決する。
 *   data URL（移行前の既存データ）→ そのまま返す
 *   path（移行後）              → 署名URL
 */
export async function resolveStoredUrl(
  supabase: SupabaseClient,
  bucket: string,
  value: string | null | undefined,
  expiresInSec = 60 * 60,
): Promise<string | null> {
  if (!value) return null;
  if (isDataUrl(value)) return value;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(value, expiresInSec);
  return data?.signedUrl ?? null;
}

/** 複数まとめて解決（署名は並列）。 */
export async function resolveStoredUrls(
  supabase: SupabaseClient,
  bucket: string,
  values: (string | null | undefined)[],
  expiresInSec = 60 * 60,
): Promise<(string | null)[]> {
  return Promise.all(values.map((v) => resolveStoredUrl(supabase, bucket, v, expiresInSec)));
}

/** Storage から削除（data URL の値は無視）。 */
export async function removeStoredPaths(
  supabase: SupabaseClient,
  bucket: string,
  values: (string | null | undefined)[],
): Promise<void> {
  const paths = values.filter((v): v is string => Boolean(v) && !isDataUrl(v));
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) console.error(`[storage/${bucket}] remove error`, error);
}
