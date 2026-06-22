import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const { id } = await params;

  const { data, error } = await supabase
    .from("invoice_documents")
    .select("id, month_yyyy_mm, issue_date, amount, status, invoice_no, payload, updated_at")
    .eq("id", id)
    .eq("company_code", user.companyCode)
    .eq("driver_id", user.driverId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "請求書が見つかりません" }, { status: 404 });
  }

  return NextResponse.json({
    invoice: {
      id: data.id,
      month: data.month_yyyy_mm,
      issueDate: data.issue_date,
      amount: Number(data.amount) || 0,
      status: (data.status === "sent" ? "pending_approval" : data.status) ?? "draft",
      invoiceNo: data.invoice_no ?? "",
      payload: data.payload ?? {},
      updatedAt: data.updated_at ?? null,
    },
  });
}

