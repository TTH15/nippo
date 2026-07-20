// ============================================================
// LINE 連携のワンタイムコード（roadmap-2026-07 E②）。
// フロー: アプリでコード発行 → 本人が LINE トークにそのまま送信 →
//         webhook が突合して identities.line_user_id を確定。
// LIFF/LINEログインを使わないのは、チャネル情報だけで完結し
// 追加のチャネル設定・同意画面が要らないため。
// ============================================================
import { supabase } from "@/server/db/client";

/** 有効期限。トークに貼るまでの猶予として十分で、漏洩時の窓は短く。 */
const TTL_MINUTES = 10;

/** 見間違いやすい文字（0/O/1/I/L）を除いた英数字。 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * identity に対する連携コードを発行する。
 * 既存の未使用コードは無効化してから作る（1人1つ＝どれが有効か迷わせない）。
 */
export async function issueLinkCode(identityId: string): Promise<{ code: string; expiresAt: string }> {
  await supabase
    .from("line_link_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("identity_id", identityId)
    .is("consumed_at", null);

  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

  // PK 衝突（同時刻に同じコードが出た）だけは即座に再試行する
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const { error } = await supabase
      .from("line_link_codes")
      .insert({ code, identity_id: identityId, expires_at: expiresAt });
    if (!error) return { code, expiresAt };
    if (error.code !== "23505") throw new Error(`連携コードの発行に失敗しました: ${error.message}`);
  }
  throw new Error("連携コードの発行に失敗しました（コード生成の衝突が続きました）");
}

export type ConsumeResult =
  | { ok: true; identityId: string }
  | { ok: false; reason: "not_found" | "expired" | "used" | "taken" };

/**
 * コードを消費して line_user_id を確定する。
 * 「別の identity が同じ line_user_id を持っている」場合は taken を返す
 * （line_user_id は UNIQUE。乗っ取り防止のため黙って奪わない）。
 */
export async function consumeLinkCode(code: string, lineUserId: string): Promise<ConsumeResult> {
  const { data: row } = await supabase
    .from("line_link_codes")
    .select("code, identity_id, expires_at, consumed_at")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();

  if (!row) return { ok: false, reason: "not_found" };
  if (row.consumed_at) return { ok: false, reason: "used" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };

  const { data: holder } = await supabase
    .from("identities")
    .select("id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (holder && holder.id !== row.identity_id) return { ok: false, reason: "taken" };

  const now = new Date().toISOString();
  const { error: linkError } = await supabase
    .from("identities")
    .update({ line_user_id: lineUserId, line_linked_at: now, line_blocked_at: null })
    .eq("id", row.identity_id);
  if (linkError) throw new Error(`LINE 連携の保存に失敗しました: ${linkError.message}`);

  await supabase.from("line_link_codes").update({ consumed_at: now }).eq("code", row.code);

  return { ok: true, identityId: row.identity_id as string };
}
