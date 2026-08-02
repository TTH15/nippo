import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// 公開: 参加入口の事前確認。PII は返さない。
// - ?invite=<token> … 単回招待リンク。org 表示名を返す（未使用・期限内のみ）。
//   invites.name は運営の宛先メモ（管理用）であり本人には返さない＝氏名は必ず本人が入力する。
// - ?code=<join_code> … 共有参加コード。org 表示名のみを返す
export async function GET(req: NextRequest) {
  const invite = (req.nextUrl.searchParams.get("invite") || "").trim();
  if (invite) {
    const { data: row, error } = await supabase
      .from("invites")
      .select("used_at, revoked_at, expires_at, organizations ( name, status )")
      .eq("token", invite)
      .maybeSingle();
    if (error) {
      console.error("[join/lookup] invite", error);
      return NextResponse.json({ error: "サーバーエラー" }, { status: 500 });
    }
    // 使用済み／期限切れは理由を分けて返す（2026-08-02 オーナー判断: 本人が状況を
    // 理解しやすい方を優先。「使用済み」表示が第三者に申請済みを示唆しうる点は許容）。
    // 不正トークン・失効・org 停止は従来どおり中立メッセージ。
    const org = (row?.organizations ?? null) as { name: string; status: string } | null;
    if (!row || !org || org.status !== "active" || row.revoked_at) {
      return NextResponse.json({ error: "この招待リンクは無効です" }, { status: 404 });
    }
    if (row.used_at) {
      return NextResponse.json({ error: "このリンクは使用済みです" }, { status: 404 });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "リンクの有効期限が切れています" }, { status: 404 });
    }
    return NextResponse.json({ organizationName: org.name });
  }

  const code = (req.nextUrl.searchParams.get("code") || "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "参加コードを入力してください" }, { status: 400 });
  }
  const { data: org, error } = await supabase
    .from("organizations")
    .select("name, status")
    .eq("join_code", code)
    .maybeSingle();
  if (error) {
    console.error("[join/lookup]", error);
    return NextResponse.json({ error: "サーバーエラー" }, { status: 500 });
  }
  if (!org || org.status !== "active") {
    return NextResponse.json({ error: "参加コードが無効です" }, { status: 404 });
  }
  return NextResponse.json({ organizationName: org.name });
}
