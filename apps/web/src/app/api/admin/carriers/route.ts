import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { loadOrgCarrierIds } from "@/server/carriers/orgCarriers";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: キャリア一覧（units / unit_fields をネストして返す）。当 org が有効化したキャリアのみ。
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const orgCarrierIds = await loadOrgCarrierIds(supabase, orgId);

  const carriersQ = supabase.from("carriers").select("*").order("sort_order");
  const unitsQ = supabase.from("units").select("*").order("sort_order");
  const [{ data: carriers, error: cErr }, { data: units, error: uErr }, { data: fields, error: fErr }] =
    await Promise.all([
      orgCarrierIds ? carriersQ.in("id", orgCarrierIds) : carriersQ,
      orgCarrierIds ? unitsQ.in("carrier_id", orgCarrierIds) : unitsQ,
      supabase.from("unit_fields").select("*").order("sort_order"),
    ]);

  if (cErr || uErr || fErr) {
    console.error(cErr || uErr || fErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const fieldsByUnit = new Map<string, any[]>();
  (fields ?? []).forEach((f: any) => {
    const arr = fieldsByUnit.get(f.unit_id) ?? [];
    arr.push(f);
    fieldsByUnit.set(f.unit_id, arr);
  });

  const unitsByCarrier = new Map<string, any[]>();
  (units ?? []).forEach((u: any) => {
    const arr = unitsByCarrier.get(u.carrier_id) ?? [];
    arr.push({ ...u, fields: fieldsByUnit.get(u.id) ?? [] });
    unitsByCarrier.set(u.carrier_id, arr);
  });

  const result = (carriers ?? []).map((c: any) => ({
    ...c,
    units: unitsByCarrier.get(c.id) ?? [],
  }));

  return NextResponse.json({ carriers: result });
}

// POST: キャリア追加
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "名称は必須です" }, { status: 400 });
  }

  // sort_order は末尾へ
  const { data: maxRow } = await supabase
    .from("carriers")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (Number(maxRow?.sort_order) || 0) + 1;

  const { data, error } = await supabase
    .from("carriers")
    .insert({
      name,
      // code は運営作成キャリアでは任意（NULL可）。指定があれば採用。
      code: typeof body.code === "string" && body.code.trim() ? body.code.trim() : null,
      sort_order: nextOrder,
      active: true,
    })
    .select("*")
    .single();

  if (error) {
    console.error(error);
    const msg = error.code === "23505" ? "同名/同コードのキャリアが既に存在します" : "DB error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // 作成したキャリアを当 org に有効化（company_carriers）。これで一覧に出る＝org専用扱い。
  await supabase.from("company_carriers").insert({ org_id: orgId, carrier_id: data.id });

  return NextResponse.json({ carrier: { ...data, units: [] } });
}
