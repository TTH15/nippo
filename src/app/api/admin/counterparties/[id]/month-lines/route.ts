import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

function parseMonth(monthParam: string | null): string | null {
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) return null;
  return monthParam;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id: invoiceAddressId } = await params;
  const monthParam = req.nextUrl.searchParams.get("month");
  const month = parseMonth(monthParam);
  if (!month) {
    return NextResponse.json({ error: "month=YYYY-MM が必要です" }, { status: 400 });
  }

  const { data: addr, error: addrErr } = await supabase
    .from("invoice_addresses")
    .select("id")
    .eq("id", invoiceAddressId)
    .eq("company_code", user.companyCode)
    .maybeSingle();

  if (addrErr) {
    console.error(addrErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!addr) {
    return NextResponse.json({ error: "取引先が見つかりません" }, { status: 404 });
  }

  let body: { lines?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawLines = body.lines;
  if (!Array.isArray(rawLines)) {
    return NextResponse.json({ error: "lines 配列が必要です" }, { status: 400 });
  }

  const normalized: { description: string; quantity: number; unit_price: number; sort_order: number }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const row = rawLines[i] as Record<string, unknown>;
    const description = typeof row.description === "string" ? row.description : "";
    const quantity = Number(row.quantity);
    const unit_price = Number(row.unit_price);
    if (!Number.isFinite(quantity) || !Number.isFinite(unit_price)) {
      return NextResponse.json({ error: `lines[${i}] の数量・単価が不正です` }, { status: 400 });
    }
    normalized.push({
      description,
      quantity,
      unit_price,
      sort_order: i,
    });
  }

  const { error: delErr } = await supabase
    .from("counterparty_monthly_custom_lines")
    .delete()
    .eq("company_code", user.companyCode)
    .eq("invoice_address_id", invoiceAddressId)
    .eq("month_yyyy_mm", month);

  if (delErr) {
    console.error(delErr);
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  if (normalized.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const insertRows = normalized.map((r) => ({
    company_code: user.companyCode,
    invoice_address_id: invoiceAddressId,
    month_yyyy_mm: month,
    sort_order: r.sort_order,
    description: r.description,
    quantity: r.quantity,
    unit_price: r.unit_price,
  }));

  const { error: insErr } = await supabase.from("counterparty_monthly_custom_lines").insert(insertRows);

  if (insErr) {
    console.error(insErr);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: normalized.length });
}
