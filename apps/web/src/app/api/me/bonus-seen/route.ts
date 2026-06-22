import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// POST: ボーナス付与演出を表示したので既読時刻を now() に進める。
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const driverId = user.driverId as string;

  const { error } = await supabase
    .from("drivers")
    .update({ last_bonus_seen_at: new Date().toISOString() })
    .eq("id", driverId);

  if (error) {
    console.error("[/api/me/bonus-seen] error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
