import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";

export const dynamic = "force-dynamic";

// 共有プレゼンス（配車作戦盤 Stage 1）の入場券を発行する。
// クライアントは Supabase Realtime の broadcast/presence だけを使う（DB には触らない）ため、
// anon キーを「認証済みの運営にだけ」ここで手渡す（NEXT_PUBLIC には置かない）。
// チャンネル名は org×scope の HMAC で導出し、部外者が推測できないようにする
//（流れるのは視点座標・カーソル・表示名のみ＝低機微。将来 Realtime Authorization に移行可）。
// scope: map=地図の共有ビュー / shifts=シフト表の同時編集カーソル。
const SCOPES: Record<string, string> = { map: "can_view_vehicles", shifts: "can_view_shifts" };

export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") || "map";
  const cap = SCOPES[scope];
  if (!cap) {
    return NextResponse.json({ error: "unknown scope" }, { status: 400 });
  }
  const user = await requirePermission(req, cap as Parameters<typeof requirePermission>[1]);
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const secret = process.env.JWT_SECRET;
  if (!url || !anonKey || !secret) {
    return NextResponse.json(
      { error: "共有ビューが未設定です（SUPABASE_ANON_KEY を環境変数に追加してください）" },
      { status: 503 },
    );
  }

  const channel =
    scope === "map"
      ? `map-share:${createHmac("sha256", secret).update(`map-share:${orgId}`).digest("hex").slice(0, 24)}`
      : `share:${scope}:${createHmac("sha256", secret).update(`share:${scope}:${orgId}`).digest("hex").slice(0, 24)}`;
  return NextResponse.json({ url, anonKey, channel });
}
