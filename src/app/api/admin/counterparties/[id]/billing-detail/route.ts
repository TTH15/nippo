import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { computeCounterpartyMonthBillingDetail } from "@/server/billing/computeCounterpartyMonthRevenue";

export const dynamic = "force-dynamic";

function getMonthRange(monthParam: string | null): { month: string; startDate: string; endDate: string } {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-");
    year = Number(y);
    month = Number(m);
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    month: `${year}-${mm}`,
    startDate: `${year}-${mm}-01`,
    endDate: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const { id: invoiceAddressId } = await params;
  const monthParam = req.nextUrl.searchParams.get("month");
  const range = getMonthRange(monthParam);

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

  try {
    const { systemLines, systemTotal } = await computeCounterpartyMonthBillingDetail(
      supabase,
      range.startDate,
      range.endDate,
      invoiceAddressId
    );

    const { data: customRows, error: customErr } = await supabase
      .from("counterparty_monthly_custom_lines")
      .select("id, description, quantity, unit_price, sort_order")
      .eq("company_code", user.companyCode)
      .eq("invoice_address_id", invoiceAddressId)
      .eq("month_yyyy_mm", range.month)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (customErr) {
      console.error(customErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const customLines = (customRows ?? []).map((row: Record<string, unknown>) => {
      const qty = Number(row.quantity) || 0;
      const unit = Number(row.unit_price) || 0;
      return {
        id: String(row.id),
        description: String(row.description ?? ""),
        quantity: qty,
        unitPrice: unit,
        amount: Math.round(qty * unit * 100) / 100,
      };
    });

    const customTotal = customLines.reduce((s, l) => s + l.amount, 0);

    return NextResponse.json({
      month: range.month,
      systemLines,
      customLines,
      systemTotal,
      customTotal,
      grandTotal: systemTotal + customTotal,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
