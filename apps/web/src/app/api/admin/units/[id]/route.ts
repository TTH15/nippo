import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { orgOwnsCarrier } from "@/server/carriers/orgCarriers";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

const BILLING_TYPES = ["PER_PIECE", "FIXED"];

/** unit を当 org が管理してよいか（unit の carrier が当 org の有効化集合にあるか）。 */
async function orgOwnsUnit(orgId: string, unitId: string): Promise<boolean> {
  const { data } = await supabase.from("units").select("carrier_id").eq("id", unitId).maybeSingle();
  if (!data?.carrier_id) return false;
  return orgOwnsCarrier(supabase, orgId, data.carrier_id as string);
}

// PATCH: unit 更新
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;
  if (!(await orgOwnsUnit(orgId, id))) {
    return NextResponse.json({ error: "unit が見つかりません" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if ("code" in body) patch.code = body.code ? String(body.code).trim() : null;
  if (BILLING_TYPES.includes(body.billing_type)) patch.billing_type = body.billing_type;
  if (typeof body.sort_order === "number") patch.sort_order = Math.floor(body.sort_order);
  if (typeof body.active === "boolean") patch.active = body.active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "更新項目がありません" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("units")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error(error);
    const msg = error.code === "23505" ? "このキャリア内に同名の unit が既に存在します" : "DB error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ unit: data });
}

// DELETE: unit 削除（単価/報告で利用中ならハード削除を拒否）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;
  if (!(await orgOwnsUnit(orgId, id))) {
    return NextResponse.json({ error: "unit が見つかりません" }, { status: 404 });
  }

  const { count: rateCount } = await supabase
    .from("course_unit_rates")
    .select("id", { count: "exact", head: true })
    .eq("unit_id", id);
  const { count: entryCount } = await supabase
    .from("report_entries")
    .select("id", { count: "exact", head: true })
    .eq("unit_id", id);

  if ((rateCount ?? 0) > 0 || (entryCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "この unit は利用中のため削除できません（単価設定または報告データが紐づいています）。無効化してください。",
      },
      { status: 409 },
    );
  }

  // unit_fields は FK CASCADE で同時削除される
  const { error } = await supabase.from("units").delete().eq("id", id);
  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
