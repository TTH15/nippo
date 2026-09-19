import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { hasRecentAuth } from "@/server/auth/recentAuth";
import { reauthIdentity } from "@/server/auth/reauthIdentity";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;
  if (!user.identityId) return NextResponse.json({ error: "本人確認の設定がありません" }, { status: 400 });
  try {
    const { phone, phoneMasked, hasPasskey } = await reauthIdentity(user.identityId);
    return NextResponse.json({ recent: await hasRecentAuth(req, user), canUseSms: !!phone, phoneMasked, hasPasskey },
      { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "本人確認の設定を読み込めませんでした。もう一度お試しください" }, { status: 503 }); }
}
