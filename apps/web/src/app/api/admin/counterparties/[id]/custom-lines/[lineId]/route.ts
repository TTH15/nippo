import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

function parseMonth(monthParam: string | null): string | null {
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) return null;
  return monthParam;
}

/** 手入力・控除行の品目・数量・単価（ブラー保存用） */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { id: invoiceAddressId, lineId } = await params;
  const monthParam = req.nextUrl.searchParams.get("month");
  const month = parseMonth(monthParam);
  if (!month) {
    return NextResponse.json({ error: "month=YYYY-MM が必要です" }, { status: 400 });
  }

  let body: { description?: string; quantity?: number; unit_price?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.description === "string") updates.description = body.description;
  if (typeof body.quantity === "number" && Number.isFinite(body.quantity)) {
    updates.quantity = body.quantity;
  }
  if (typeof body.unit_price === "number" && Number.isFinite(body.unit_price)) {
    updates.unit_price = body.unit_price;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "更新項目がありません" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("counterparty_monthly_custom_lines")
    .update(updates)
    .eq("id", lineId)
    .eq("org_id", orgId)
    .eq("invoice_address_id", invoiceAddressId)
    .eq("month_yyyy_mm", month)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "行が見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
