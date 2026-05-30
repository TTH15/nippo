import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { computeDriverAutoPayout } from "@/server/billing/driverPayout";

export const dynamic = "force-dynamic";

function getMonthRange(monthParam: string | null): { month: string; startDate: string; endDate: string } {
  let year: number;
  let month: number;
  const now = new Date();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-");
    year = Number(y);
    month = Number(m);
  } else {
    year = now.getFullYear();
    month = now.getMonth() + 1;
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

type BreakdownLine = {
  title: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const driverId = req.nextUrl.searchParams.get("driver_id");
  if (!driverId) {
    return NextResponse.json({ error: "driver_id is required" }, { status: 400 });
  }
  const { month, startDate, endDate } = getMonthRange(req.nextUrl.searchParams.get("month"));

  // 自動算出の報酬明細を v2 集計モデルから取得（admin/payments と一致）
  const autoPayout = await computeDriverAutoPayout(supabase, driverId, startDate, endDate);
  const lines: BreakdownLine[] = autoPayout.lines.map((l) => ({
    title: l.title,
    qty: l.qty,
    unitPrice: l.unitPrice,
    amount: l.amount,
  }));
  const total = autoPayout.total;

  return NextResponse.json({
    month,
    startDate,
    endDate,
    lines,
    total,
  });
}

