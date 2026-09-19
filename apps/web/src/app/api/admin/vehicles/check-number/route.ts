import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
export const dynamic = "force-dynamic";

// 読取後の確認用。自社の同じナンバーだけを返し、他社の車両の有無は知らせない。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const values = ["numberPrefix", "numberClass", "numberHiragana", "numberNumeric"].map(key => req.nextUrl.searchParams.get(key)?.trim() ?? "");
  if (values.some(value => !value || value.length > 20)) return NextResponse.json({ error: "ナンバーを確認してください。" }, { status: 400 });
  const { data, error } = await supabase.from("vehicles")
    .select("id, manufacturer, brand")
    .eq("owner_org_id", orgId).eq("is_disposed", false)
    .eq("number_prefix", values[0]).eq("number_class", values[1])
    .eq("number_hiragana", values[2]).eq("number_numeric", values[3]).limit(10);
  if (error) return NextResponse.json({ error: "登録済みの車両を確認できませんでした。もう一度お試しください。" }, { status: 500 });
  return NextResponse.json({ vehicles: data });
}
