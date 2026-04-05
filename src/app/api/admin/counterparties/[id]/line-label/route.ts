import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

function parseMonth(monthParam: string | null): string | null {
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) return null;
  return monthParam;
}

/** 摘要（品目名）のオーバーライド。フォーカスアウト保存用。line_key: tk:/nk:/fx:/slr:/sll:/cu:（手入力は custom-line API 推奨） */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id: invoiceAddressId } = await params;
  let body: { month?: string; lineKey?: string; displayLabel?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const month = parseMonth(body.month ?? null);
  if (!month) {
    return NextResponse.json({ error: "month (YYYY-MM) が必要です" }, { status: 400 });
  }
  const lineKey = typeof body.lineKey === "string" ? body.lineKey.trim() : "";
  if (!lineKey) {
    return NextResponse.json({ error: "lineKey が必要です" }, { status: 400 });
  }
  const displayLabel = typeof body.displayLabel === "string" ? body.displayLabel.trim() : "";

  const { data: addr, error: addrErr } = await supabase
    .from("invoice_addresses")
    .select("id")
    .eq("id", invoiceAddressId)
    .eq("company_code", user.companyCode)
    .maybeSingle();

  if (addrErr || !addr) {
    return NextResponse.json({ error: "取引先が見つかりません" }, { status: 404 });
  }

  await supabase
    .from("counterparty_monthly_line_labels")
    .delete()
    .eq("company_code", user.companyCode)
    .eq("invoice_address_id", invoiceAddressId)
    .eq("month_yyyy_mm", month)
    .eq("line_key", lineKey);

  if (!displayLabel) {
    return NextResponse.json({ ok: true, cleared: true });
  }

  const { error: insErr } = await supabase.from("counterparty_monthly_line_labels").insert({
    company_code: user.companyCode,
    invoice_address_id: invoiceAddressId,
    month_yyyy_mm: month,
    line_key: lineKey,
    display_label: displayLabel,
    updated_at: new Date().toISOString(),
  });

  if (insErr) {
    console.error(insErr);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
