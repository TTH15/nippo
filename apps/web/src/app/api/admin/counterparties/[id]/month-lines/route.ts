import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

function parseMonth(monthParam: string | null): string | null {
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) return null;
  return monthParam;
}

type LineIn = {
  description?: string;
  quantity?: number;
  unit_price?: number;
};

function normalizeLines(
  raw: unknown,
  rowKind: "main" | "deduction"
): { description: string; quantity: number; unit_price: number; sort_order: number; row_kind: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { description: string; quantity: number; unit_price: number; sort_order: number; row_kind: string }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as LineIn;
    const description = typeof row.description === "string" ? row.description : "";
    const quantity = Number(row.quantity);
    const unit_price = Number(row.unit_price);
    if (!Number.isFinite(quantity) || !Number.isFinite(unit_price)) {
      throw new Error(`lines[${i}] の数量・単価が不正です`);
    }
    out.push({
      description,
      quantity,
      unit_price,
      sort_order: i,
      row_kind: rowKind,
    });
  }
  return out;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

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
    .eq("org_id", orgId)
    .maybeSingle();

  if (addrErr) {
    console.error(addrErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!addr) {
    return NextResponse.json({ error: "取引先が見つかりません" }, { status: 404 });
  }

  let body: { mainLines?: unknown; deductionLines?: unknown; lines?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let mainNormalized: ReturnType<typeof normalizeLines>;
  let dedNormalized: ReturnType<typeof normalizeLines>;
  try {
    const legacy = body.lines;
    if (legacy !== undefined && body.mainLines === undefined && body.deductionLines === undefined) {
      mainNormalized = normalizeLines(legacy, "main");
      dedNormalized = [];
    } else {
      mainNormalized = normalizeLines(body.mainLines ?? [], "main");
      dedNormalized = normalizeLines(body.deductionLines ?? [], "deduction");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid lines";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { error: delErr } = await supabase
    .from("counterparty_monthly_custom_lines")
    .delete()
    .eq("org_id", orgId)
    .eq("invoice_address_id", invoiceAddressId)
    .eq("month_yyyy_mm", month);

  if (delErr) {
    console.error(delErr);
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  let ord = 0;
  const allRows = [...mainNormalized, ...dedNormalized].map((r) => ({
    org_id: orgId,
    company_code: user.companyCode,
    invoice_address_id: invoiceAddressId,
    month_yyyy_mm: month,
    sort_order: ord++,
    description: r.description,
    quantity: r.quantity,
    unit_price: r.unit_price,
    row_kind: r.row_kind,
  }));

  if (allRows.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const { error: insErr } = await supabase.from("counterparty_monthly_custom_lines").insert(allRows);

  if (insErr) {
    console.error(insErr);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: allRows.length });
}
