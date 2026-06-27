import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// 公開: join_code → active org の「表示名のみ」を返す。
// 送信前の会社名確認用（誤コードを本人に気づかせる）。PII は返さない。
export async function GET(req: NextRequest) {
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
