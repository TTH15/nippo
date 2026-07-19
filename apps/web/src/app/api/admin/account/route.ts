import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";

export const dynamic = "force-dynamic";

/** ログイン中の運営メンバー自身のアカウント状態（Passkey登録済みか等）。
 * 返すのは本人の情報のみなので、ロールでは絞らない（カスタムロールも運営画面から
 * 自分のアカウント設定を開ける。§2-6a の旧ホワイトリスト廃止と同方針）。 */
export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (isAuthError(user)) return user;

  const identityId = await resolveIdentityId(user);
  let hasPasskey = false;
  if (identityId) {
    const { count } = await supabase
      .from("passkey_credentials")
      .select("id", { count: "exact", head: true })
      .eq("identity_id", identityId);
    hasPasskey = (count ?? 0) > 0;
  }

  return NextResponse.json({ hasPasskey });
}
