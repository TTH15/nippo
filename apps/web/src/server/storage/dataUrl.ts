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
import { verifyFileContent } from "@/server/storage/fileSignature";

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
/**
 * バイト列を検査してアップロードする（multipart/FormData 経路用）。
 * base64 data URL 経由（+33%転送・メモリ肥大）を避けたい新規経路はこちらを使う。
 */
export async function uploadBytes(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string,
  file: { bytes: Uint8Array; mime: string },
  allowedMime: readonly string[] = ["application/pdf", "image/jpeg", "image/png"],
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  // ★中身を検査する。MIME は送信側が自由に書けるため、これが無いと
  //   「image/png と称した HTML」を保存してしまう。
  const verified = verifyFileContent(file.bytes, allowedMime, file.mime);
  if (!verified.ok) return { ok: false, message: verified.message };

  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${prefix}/${rand}.${extensionForMime(file.mime)}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file.bytes, {
    contentType: file.mime,
    upsert: false,
  });
  if (error) {
    console.error(`[storage/${bucket}] upload error`, error);
    return { ok: false, message: "アップロードに失敗しました（バケット未作成の可能性）。" };
  }
  return { ok: true, path };
}

export async function uploadDataUrl(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string,
  value: string,
  allowedMime: readonly string[] = ["application/pdf", "image/jpeg", "image/png"],
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (!isDataUrl(value)) return { ok: true, path: value };

  const decoded = decodeDataUrl(value);
  if (!decoded) return { ok: false, message: "ファイル形式を認識できませんでした。" };

  // ★中身を検査する。data URL の MIME 部分は送信側が自由に書けるため、
  //   これが無いと「image/png と称した HTML」を保存してしまう。
  const verified = verifyFileContent(decoded.bytes, allowedMime, decoded.mime);
  if (!verified.ok) return { ok: false, message: verified.message };

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
  const { data } = await supabase.storage
    .from(bucket)
    .createSignedUrl(value, expiresInSec, signedUrlOptions(value));
  return data?.signedUrl ?? null;
}

/**
 * PDF はブラウザ内蔵ビューアで JavaScript が動きうるため、
 * インライン表示させず必ずダウンロードさせる（Content-Disposition: attachment）。
 * 画像はマジックバイト検査済みで描画されるだけなので、表示を壊さないよう対象外。
 */
export function signedUrlOptions(path: string): { download: boolean } | undefined {
  return path.toLowerCase().endsWith(".pdf") ? { download: true } : undefined;
}

/**
 * 複数まとめて解決。署名は createSignedUrls で一括発行する
 * （1パス=1リクエストだと一覧APIが件数分の Storage 往復になるため）。
 * download オプション（PDF）はリクエスト単位でしか指定できないので、PDF とそれ以外の
 * 2グループに分けて発行する（実質 1〜2 リクエスト）。
 */
export async function resolveStoredUrls(
  supabase: SupabaseClient,
  bucket: string,
  values: (string | null | undefined)[],
  expiresInSec = 60 * 60,
): Promise<(string | null)[]> {
  // data URL（移行前データ）はそのまま返し、path だけ署名対象にする
  const out: (string | null)[] = values.map((v) => (v && isDataUrl(v) ? v : null));
  const groups = [
    { download: false, indexes: [] as number[], paths: [] as string[] },
    { download: true, indexes: [] as number[], paths: [] as string[] },
  ];
  values.forEach((v, i) => {
    if (!v || isDataUrl(v)) return;
    const g = groups[signedUrlOptions(v) ? 1 : 0];
    g.indexes.push(i);
    g.paths.push(v);
  });
  await Promise.all(
    groups.map(async (g) => {
      if (g.paths.length === 0) return;
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrls(g.paths, expiresInSec, g.download ? { download: true } : undefined);
      if (error || !data) {
        console.error(`[storage/${bucket}] createSignedUrls error`, error);
        return;
      }
      // 返り値は渡した paths と同順。個別に失敗した行は signedUrl が空になる
      data.forEach((row, j) => {
        out[g.indexes[j]] = row.signedUrl || null;
      });
    }),
  );
  return out;
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
