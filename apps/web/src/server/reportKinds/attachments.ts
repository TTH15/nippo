import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_ACCEPT_MIME, DEFAULT_MAX_FILE_BYTES, type AnswerAttachment } from "./fields";
import { verifyFileContent } from "@/server/storage/fileSignature";
import { signedUrlOptions } from "@/server/storage/dataUrl";

// ============================================================
// 諸報告の添付ファイル（Supabase Storage・非公開バケット）入出力。
// サーバ専用（service-role クライアント前提）。
// ============================================================

export const REPORT_BUCKET = "report-attachments";

export function checkFile(mime: string, size: number): { ok: true } | { ok: false; message: string } {
  if (!DEFAULT_ACCEPT_MIME.includes(mime)) {
    return { ok: false, message: "対応していないファイル形式です（PDF / JPEG / PNG のみ）。" };
  }
  if (size > DEFAULT_MAX_FILE_BYTES) {
    return { ok: false, message: `ファイルサイズは ${Math.floor(DEFAULT_MAX_FILE_BYTES / (1024 * 1024))}MB 以下にしてください。` };
  }
  return { ok: true };
}

/** Storage へアップロードし、保存パスを返す。 */
export async function uploadReportFile(
  supabase: SupabaseClient,
  driverId: string,
  file: { bytes: ArrayBuffer | Uint8Array; name: string; mime: string },
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  // 申告 MIME・拡張子は偽装できるため、中身（マジックバイト）で検証する
  const verified = verifyFileContent(
    new Uint8Array(file.bytes as ArrayBuffer),
    DEFAULT_ACCEPT_MIME,
    file.mime,
  );
  if (!verified.ok) return { ok: false, message: verified.message };

  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const rand = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${driverId}/${rand}.${ext}`;
  const { error } = await supabase.storage.from(REPORT_BUCKET).upload(path, file.bytes, {
    contentType: file.mime,
    upsert: false,
  });
  if (error) {
    console.error("[reportKinds/attachments] upload error", error);
    return { ok: false, message: "アップロードに失敗しました（バケット未作成の可能性）。" };
  }
  return { ok: true, path };
}

/** 添付に短時間の署名URLを付与（閲覧用）。 */
export async function signAttachments(
  supabase: SupabaseClient,
  attachments: AnswerAttachment[],
  expiresInSec = 60 * 30,
): Promise<(AnswerAttachment & { url: string | null })[]> {
  return Promise.all(
    attachments.map(async (a) => {
      // PDF はダウンロード強制（内蔵ビューアの JS 実行を避ける）。画像は表示のまま。
      const { data } = await supabase.storage
        .from(REPORT_BUCKET)
        .createSignedUrl(a.path, expiresInSec, signedUrlOptions(a.path));
      return { ...a, url: data?.signedUrl ?? null };
    }),
  );
}

/** Storage からオブジェクトを削除（報告削除時など）。 */
export async function removeReportFiles(supabase: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(REPORT_BUCKET).remove(paths);
  if (error) console.error("[reportKinds/attachments] remove error", error);
}
