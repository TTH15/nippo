import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { requirePlatformAdmin } from "@/server/platform";

export const dynamic = "force-dynamic";

// 運営社オンボーディング申請の一覧（プラットフォーム運営者のみ）。
// 申請内容はプラットフォーム宛に提出された情報＝テナント PII ではないため表示可。

export async function GET(req: NextRequest) {
  const ctx = await requirePlatformAdmin(req);
  if (ctx instanceof NextResponse) return ctx;

  const { data, error } = await supabase
    .from("org_applications")
    .select(
      "id, company_name, corporate_number, representative, contact_name, contact_email, contact_phone, address, message, status, created_at, decided_at, decided_note, org_id",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[platform/applications]", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ applications: data ?? [] });
}
