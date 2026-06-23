import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { orgOwnsCarrier } from "@/server/carriers/orgCarriers";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

const BILLING_TYPES = ["PER_PIECE", "FIXED"] as const;

// POST: unit 追加
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const body = await req.json().catch(() => ({}));
  const carrierId = typeof body.carrier_id === "string" ? body.carrier_id : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const billingType = BILLING_TYPES.includes(body.billing_type) ? body.billing_type : "PER_PIECE";

  if (!carrierId) return NextResponse.json({ error: "carrier_id は必須です" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "名称は必須です" }, { status: 400 });
  if (!(await orgOwnsCarrier(supabase, orgId, carrierId))) {
    return NextResponse.json({ error: "キャリアが見つかりません" }, { status: 404 });
  }

  const { data: maxRow } = await supabase
    .from("units")
    .select("sort_order")
    .eq("carrier_id", carrierId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (Number(maxRow?.sort_order) || 0) + 1;

  const { data, error } = await supabase
    .from("units")
    .insert({
      carrier_id: carrierId,
      name,
      code: typeof body.code === "string" && body.code.trim() ? body.code.trim() : null,
      billing_type: billingType,
      sort_order: nextOrder,
      active: true,
    })
    .select("*")
    .single();

  if (error) {
    console.error(error);
    const msg = error.code === "23505" ? "このキャリア内に同名の unit が既に存在します" : "DB error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ unit: { ...data, fields: [] } });
}
