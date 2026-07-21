import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { signInvoiceAttachments } from "@/server/billing/invoiceAttachments";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const month = req.nextUrl.searchParams.get("month");
  let query = supabase
    .from("invoice_documents")
    .select("id, month_yyyy_mm, issue_date, amount, status, invoice_no, payload, updated_at")
    .eq("org_id", orgId)
    .eq("driver_id", user.driverId)
    .order("updated_at", { ascending: false });

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    query = query.eq("month_yyyy_mm", month);
  }

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const invoices = await Promise.all(
    (data ?? []).map(async (r: any) => ({
      id: r.id,
      month: r.month_yyyy_mm,
      issueDate: r.issue_date,
      amount: Number(r.amount) || 0,
      status: (r.status === "sent" ? "pending_approval" : r.status) ?? "draft",
      invoiceNo: r.invoice_no ?? "",
      // 添付は Storage のパスのみ持つため、表示用に署名URLを付ける
      payload: (await signInvoiceAttachments(supabase, r.payload ?? {})) ?? {},
      updatedAt: r.updated_at ?? null,
    })),
  );

  return NextResponse.json({ invoices });
}

