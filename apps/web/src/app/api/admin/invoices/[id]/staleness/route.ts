import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

function monthRange(month: string): { start: string; end: string } | null {
  const m = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mm) || mm < 1 || mm > 12) return null;
  const lastDay = new Date(y, mm, 0).getDate();
  return {
    start: `${y}-${String(mm).padStart(2, "0")}-01`,
    end: `${y}-${String(mm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const { id } = await params;

  const { data: invoice, error: invoiceErr } = await supabase
    .from("invoice_documents")
    .select("id, month_yyyy_mm, counterparty_invoice_address_id, created_at, payload")
    .eq("id", id)
    .eq("company_code", user.companyCode)
    .maybeSingle();

  if (invoiceErr || !invoice) {
    return NextResponse.json({ error: "請求書が見つかりません" }, { status: 404 });
  }

  const source = String((invoice.payload as any)?.source ?? "");
  const isUploadedDocument = source === "uploaded_document";
  const range = monthRange(String(invoice.month_yyyy_mm ?? ""));
  const counterpartyId = String(invoice.counterparty_invoice_address_id ?? "");
  if (!range || !counterpartyId || isUploadedDocument) {
    return NextResponse.json({
      stale: false,
      snapshotAt: invoice.created_at ?? null,
      latestSourceUpdatedAt: null,
    });
  }

  const createdAtIso = String(invoice.created_at ?? "");
  const { data: rows, error: rowsErr } = await supabase
    .from("sales_log_entries")
    .select("updated_at")
    .eq("company_code", user.companyCode)
    .eq("counterparty_invoice_address_id", counterpartyId)
    .gte("log_date", range.start)
    .lte("log_date", range.end)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (rowsErr) {
    console.error(rowsErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const latestSourceUpdatedAt = rows?.[0]?.updated_at ?? null;
  const stale =
    Boolean(createdAtIso) &&
    Boolean(latestSourceUpdatedAt) &&
    new Date(String(latestSourceUpdatedAt)).getTime() > new Date(createdAtIso).getTime();

  return NextResponse.json({
    stale,
    snapshotAt: invoice.created_at ?? null,
    latestSourceUpdatedAt,
  });
}

