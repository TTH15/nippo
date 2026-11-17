import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
export const dynamic = "force-dynamic";

// カットオーバー済みの旧送信口。旧表だけの保存成功や、確定保護の迂回を起こさない。
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  return NextResponse.json({ error: "日報画面を開き直して送信してください", redirectTo: "/submit" }, { status: 410 });
}
