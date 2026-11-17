import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError, getCapabilities } from "@/server/auth";
import { supabase } from "@/server/db/client";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;
  if (user.purpose !== "admin") return NextResponse.json({ error: "管理画面にログインし直してください" }, { status: 401 });
  try {
    const [caps, driver] = await Promise.all([
      getCapabilities(user),
      // tenant-scope-ok: 認証済み本人の所属ロールだけを再取得する
      supabase.from("drivers").select("role").eq("id", user.driverId).single(),
    ]);
    if (driver.error) throw driver.error;
    return NextResponse.json({ capabilities: [...caps], role: driver.data.role }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "権限を確認できませんでした" }, { status: 503 }); }
}
