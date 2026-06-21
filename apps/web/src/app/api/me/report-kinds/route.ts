import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadActiveReportKinds } from "@/server/reportKinds/config";

export const dynamic = "force-dynamic";

// ドライバー向け: 有効な報告種別の一覧（入力フォーム用）。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const kinds = await loadActiveReportKinds(supabase);
  return NextResponse.json({ kinds });
}
