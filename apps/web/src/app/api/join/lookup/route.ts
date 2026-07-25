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
    // 不正・使用済み・失効・期限切れはすべて同じ中立メッセージに集約する。
    // 「使用済み」を区別して返すと、リンクを拾った第三者に
    // 「この招待で誰かが申請済み」という情報まで漏れるため。
    const org = (row?.organizations ?? null) as { name: string; status: string } | null;
    if (
      !row ||
      !org ||
      org.status !== "active" ||
      row.revoked_at ||
      row.used_at ||
      new Date(row.expires_at).getTime() < Date.now()
    ) {
      return NextResponse.json(
        { error: "この招待リンクは無効です。運営にお問い合わせください" },
        { status: 404 },
      );
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
