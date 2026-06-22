import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { buildCounterpartyBillingSnapshot } from "@/server/billing/counterpartyBillingSnapshot";

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
  const orgId = await resolveOrgId(user.driverId);

  const { id: invoiceAddressId } = await params;
  const monthParam = req.nextUrl.searchParams.get("month");
  const range = getMonthRange(monthParam);

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

  try {
    const snapshot = await buildCounterpartyBillingSnapshot(
      supabase,
      orgId,
      user.companyCode,
      invoiceAddressId,
      range.startDate,
      range.endDate,
      range.month
    );

    return NextResponse.json({
      month: snapshot.month,
      mainLines: snapshot.mainLines,
      deductLines: snapshot.deductLines,
      shiftSystemTotal: snapshot.shiftSystemTotal,
      mainSubtotal: snapshot.mainSubtotal,
      deductSubtotal: snapshot.deductSubtotal,
      grandTotal: snapshot.grandTotal,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
