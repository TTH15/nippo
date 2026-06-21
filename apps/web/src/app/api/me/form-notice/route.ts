import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadSubmitScreenConfig, isFormNoticeActiveOn } from "@/server/submitScreen/config";
import { todayJST } from "@/lib/date";

export const dynamic = "force-dynamic";

// ドライバー向け: 送信フォーム上部に表示する注意バナー。
// 期間判定はサーバ側で行い、表示すべきときだけ message を返す（非表示時は null）。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  const config = await loadSubmitScreenConfig(supabase);
  const today = todayJST();
  const active = isFormNoticeActiveOn(config.formNotice, today);

  return NextResponse.json({
    notice: active ? { message: config.formNotice.message } : null,
  });
}
