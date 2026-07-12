import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { resolveIdentityId } from "@/server/identity";

export const dynamic = "force-dynamic";

/** ログイン中の運営(ADMIN/ADMIN_VIEWER)自身のアカウント状態（Passkey登録済みか等）。 */
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
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
