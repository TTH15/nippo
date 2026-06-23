import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { generateJoinCode } from "@/server/tenant/joinCode";

export const dynamic = "force-dynamic";

// ============================================================
// join_code 管理API（運営・Phase 7a）。
// GET: 当 org の現在の参加コードを返す。
// POST: 参加コードを再生成（漏洩時の作り直し）。一意になるまでリトライ。
// ============================================================

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { data, error } = await supabase
    .from("organizations")
    .select("join_code")
    .eq("id", orgId)
    .single();
  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ joinCode: data?.join_code ?? null });
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  // 一意になるまでリトライ（join_code は部分unique）。
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateJoinCode();
    const { data: exists } = await supabase
      .from("organizations")
      .select("id")
      .eq("join_code", code)
      .maybeSingle();
    if (exists) continue;

    const { error } = await supabase
      .from("organizations")
      .update({ join_code: code })
      .eq("id", orgId);
    if (error) {
      // 同時採番の競合なら次の試行へ
      if ((error as { code?: string }).code === "23505") continue;
      console.error(error);
      return NextResponse.json({ error: "再生成に失敗しました" }, { status: 500 });
    }
    return NextResponse.json({ joinCode: code });
  }
  return NextResponse.json({ error: "コード生成に失敗しました。もう一度お試しください" }, { status: 500 });
}
