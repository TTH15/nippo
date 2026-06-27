import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { buildMergeCandidateMap } from "@/server/billing/counterpartyBillingSnapshot";

export const dynamic = "force-dynamic";

function parseMonth(monthParam: string | null): string | null {
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) return null;
  return monthParam;
}

function monthToRange(monthYm: string): { startDate: string; endDate: string } {
  const [y, m] = monthYm.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  const lastDay = new Date(y, m, 0).getDate();
  return {
    startDate: `${y}-${mm}-01`,
    endDate: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

function sameUnitPrice(a: number, b: number) {
  return Math.abs(a - b) < 0.005;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { id: invoiceAddressId } = await params;
  let body: { month?: string; sourceLineKeys?: string[]; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const month = parseMonth(body.month ?? null);
  if (!month) {
    return NextResponse.json({ error: "month (YYYY-MM) が必要です" }, { status: 400 });
  }
  const keys = [...new Set(Array.isArray(body.sourceLineKeys) ? body.sourceLineKeys.map(String) : [])];
  if (keys.length < 2) {
    return NextResponse.json({ error: "sourceLineKeys は2件以上必要です" }, { status: 400 });
  }
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description) {
    return NextResponse.json({ error: "統合後の摘要（description）が必要です" }, { status: 400 });
  }

  const { data: addr, error: addrErr } = await supabase
    .from("invoice_addresses")
    .select("id")
    .eq("id", invoiceAddressId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (addrErr || !addr) {
    return NextResponse.json({ error: "取引先が見つかりません" }, { status: 404 });
  }

  const { startDate, endDate } = monthToRange(month);

  const candidateMap = await buildMergeCandidateMap(
    supabase,
    orgId,
    user.companyCode,
    invoiceAddressId,
    startDate,
    endDate,
    month
  );

  const resolved: { lineKey: string; quantity: number; unitPrice: number }[] = [];
  for (const k of keys) {
    const c = candidateMap.get(k);
    if (!c) {
      return NextResponse.json({ error: `明細キーが見つかりません: ${k}` }, { status: 400 });
    }
    if (k.startsWith("mg:")) {
      return NextResponse.json({ error: "既に統合された行同士の再統合はできません" }, { status: 400 });
    }
    resolved.push({ lineKey: k, quantity: c.quantity, unitPrice: c.unitPrice });
  }

  const u0 = resolved[0].unitPrice;
  for (let i = 1; i < resolved.length; i++) {
    if (!sameUnitPrice(resolved[i].unitPrice, u0)) {
      return NextResponse.json(
        { error: "単価が一致する行だけ統合できます" },
        { status: 400 }
      );
    }
  }

  const totalQty = resolved.reduce((s, r) => s + r.quantity, 0);

  const { data: maxRow } = await supabase
    .from("counterparty_monthly_merged_lines")
    .select("sort_order")
    .eq("org_id", orgId)
    .eq("invoice_address_id", invoiceAddressId)
    .eq("month_yyyy_mm", month)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data: merged, error: insErr } = await supabase
    .from("counterparty_monthly_merged_lines")
    .insert({
      org_id: orgId,
      company_code: user.companyCode,
      invoice_address_id: invoiceAddressId,
      month_yyyy_mm: month,
      sort_order: nextOrder,
      description,
      quantity: totalQty,
      unit_price: u0,
    })
    .select("id")
    .single();

  if (insErr || !merged) {
    console.error(insErr);
    return NextResponse.json({ error: insErr?.message ?? "insert failed" }, { status: 500 });
  }

  const mergeId = merged.id as string;
  const sourceRows = keys.map((source_line_key) => ({
    merged_line_id: mergeId,
    source_line_key,
  }));

  const { error: srcErr } = await supabase.from("counterparty_monthly_merged_line_sources").insert(sourceRows);

  if (srcErr) {
    console.error(srcErr);
    await supabase.from("counterparty_monthly_merged_lines").delete().eq("id", mergeId).eq("org_id", orgId);
    return NextResponse.json({ error: srcErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mergedLineId: mergeId });
}
