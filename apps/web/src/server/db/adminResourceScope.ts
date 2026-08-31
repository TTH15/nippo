import { NextResponse } from "next/server";
import { supabase } from "./client";

export const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 操作権限とは別に、変更対象が認証済み利用者の会社に属すことを確認する。 */
export async function belongsToOrg(table: "drivers" | "courses" | "vehicles", id: string, orgId: string | null): Promise<boolean> {
  if (!orgId) return false;
  const { data, error } = await supabase.from(table).select("id")
    .eq("id", id).eq(table === "vehicles" ? "owner_org_id" : "org_id", orgId).maybeSingle();
  if (error) throw error;
  return !!data;
}

export function adminMutationError(error: unknown): NextResponse {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "P0002") return NextResponse.json({ error: "対象のデータが見つかりません。" }, { status: 404 });
  if (code === "40001") return NextResponse.json({ error: "別の変更が保存されています。入力内容は残っています。最新の内容を確認してから保存し直してください。" }, { status: 409 });
  if (code === "22023" || code === "22P02" || code === "22007" || code === "22008") return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  if (code === "42501") return NextResponse.json({ error: "この操作は許可されていません。" }, { status: 403 });
  if (code === "42883" || code === "PGRST202") return NextResponse.json({ error: "保存機能のDB更新が未適用です。管理者にmigration 155の適用を依頼してください。" }, { status: 503 });
  console.error("[admin mutation] failed", code || "unknown");
  return NextResponse.json({ error: "保存・取得に失敗しました。入力を残したまま再試行してください。" }, { status: 500 });
}
