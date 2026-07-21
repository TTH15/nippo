// ============================================================
// 請求書の添付ファイル（Supabase Storage・非公開バケット）。
// 従来は payload.attachments[].dataUrl に base64 を直接入れていたため、
// 1件5MBまでの添付が一覧APIのレスポンスにも丸ごと乗っていた。
// DB には path だけを持ち、閲覧時に署名URLを付ける。
//
// 既存データ（dataUrl のまま）も表示できるよう、読み出しは両対応。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadDataUrl, resolveStoredUrl, isDataUrl } from "@/server/storage/dataUrl";

export const INVOICE_ATTACHMENT_BUCKET = "invoice-attachments";

export type InvoiceAttachment = {
  name?: string;
  type?: string;
  /** 移行後の保存先。Storage 内のパス。 */
  path?: string | null;
  /** 移行前の実体（base64）。新規保存では作らない。 */
  dataUrl?: string | null;
  [key: string]: unknown;
};

/**
 * payload 内の添付を Storage へ退避し、dataUrl を path に置き換えた payload を返す。
 * 既に path のものは触らない（再保存で二重アップロードしない）。
 */
export async function storeInvoiceAttachments(
  supabase: SupabaseClient,
  orgId: string,
  payload: Record<string, unknown> | undefined,
): Promise<{ ok: true; payload: Record<string, unknown> | undefined } | { ok: false; message: string }> {
  if (!payload) return { ok: true, payload };
  const attachments = (payload as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) return { ok: true, payload };

  const next: InvoiceAttachment[] = [];
  for (const item of attachments as InvoiceAttachment[]) {
    const dataUrl = typeof item?.dataUrl === "string" ? item.dataUrl : null;
    if (!dataUrl || !isDataUrl(dataUrl)) {
      next.push(item);
      continue;
    }
    const uploaded = await uploadDataUrl(supabase, INVOICE_ATTACHMENT_BUCKET, orgId, dataUrl);
    if (!uploaded.ok) return { ok: false, message: uploaded.message };
    // dataUrl は落として path のみ保持する（これがレスポンス肥大の元だった）
    const { dataUrl: _drop, ...rest } = item;
    next.push({ ...rest, path: uploaded.path });
  }

  return { ok: true, payload: { ...payload, attachments: next } };
}

/** 閲覧用に署名URLを付与する（詳細取得時のみ呼ぶ）。 */
export async function signInvoiceAttachments(
  supabase: SupabaseClient,
  payload: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!payload) return payload;
  const attachments = (payload as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) return payload;

  const signed = await Promise.all(
    (attachments as InvoiceAttachment[]).map(async (a) => {
      // 移行前データは dataUrl をそのまま返す
      if (a?.dataUrl) return a;
      if (!a?.path) return a;
      const url = await resolveStoredUrl(supabase, INVOICE_ATTACHMENT_BUCKET, a.path);
      return { ...a, url };
    }),
  );
  return { ...payload, attachments: signed };
}

/**
 * 一覧向けに添付の実体を落とす。件数・ファイル名は残すので
 * 「添付あり」の表示は保てる。
 */
export function stripInvoiceAttachments(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!payload) return payload;
  const attachments = (payload as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return payload;
  return {
    ...payload,
    attachments: (attachments as InvoiceAttachment[]).map((a) => ({
      name: a?.name,
      type: a?.type,
    })),
  };
}
