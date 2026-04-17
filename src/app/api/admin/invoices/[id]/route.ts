import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type InvoiceStatus = "draft" | "sent" | "paid";

function bumpInvoiceRevision(invoiceNo: string) {
  const base = String(invoiceNo || "").trim();
  if (!base) return "INV-MANUAL-R01";
  const m = base.match(/^(.*)-R(\d{2})$/);
  if (!m) return `${base}-R01`;
  const n = Number(m[2]);
  const next = Number.isFinite(n) ? Math.min(n + 1, 99) : 1;
  return `${m[1]}-R${String(next).padStart(2, "0")}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const { id } = await params;

  const { data, error } = await supabase
    .from("invoice_documents")
    .select("id, month_yyyy_mm, section, client_name, issue_date, amount, status, invoice_no, counterparty_invoice_address_id, payload, updated_at")
    .eq("id", id)
    .eq("company_code", user.companyCode)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "請求書が見つかりません" }, { status: 404 });
  }

  return NextResponse.json({
    invoice: {
      id: data.id,
      month: data.month_yyyy_mm,
      section: data.section,
      clientName: data.client_name,
      issueDate: data.issue_date,
      amount: Number(data.amount) || 0,
      status: data.status as InvoiceStatus,
      invoiceNo: data.invoice_no,
      counterpartyInvoiceAddressId: data.counterparty_invoice_address_id,
      payload: data.payload ?? {},
      updatedAt: data.updated_at,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.clientName === "string") updates.client_name = body.clientName.trim();
  if (typeof body.invoiceNo === "string" || body.invoiceNo === null) updates.invoice_no = body.invoiceNo;
  if (typeof body.amount === "number") updates.amount = body.amount;
  if (typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month)) updates.month_yyyy_mm = body.month;
  if (body.counterpartyInvoiceAddressId === null || typeof body.counterpartyInvoiceAddressId === "string") {
    updates.counterparty_invoice_address_id = body.counterpartyInvoiceAddressId;
  }
  if (typeof body.issueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.issueDate)) {
    updates.issue_date = body.issueDate;
  } else if (body.issueDate === null) {
    updates.issue_date = null;
  }
  if (body.status === "draft" || body.status === "sent" || body.status === "paid") {
    updates.status = body.status;
  }
  if (typeof body.section === "string" && (body.section === "Amazon" || body.section === "ヤマト運輸" || body.section === "郵便局")) {
    updates.section = body.section;
  }
  if (body.payload && typeof body.payload === "object") {
    updates.payload = body.payload;
  }
  if (body.markEdited === true) {
    const { data: current } = await supabase
      .from("invoice_documents")
      .select("invoice_no")
      .eq("id", id)
      .eq("company_code", user.companyCode)
      .maybeSingle();
    const baseInvoiceNo =
      typeof current?.invoice_no === "string" && current.invoice_no.trim()
        ? current.invoice_no
        : typeof body.invoiceNo === "string"
          ? body.invoiceNo
          : "";
    updates.invoice_no = bumpInvoiceRevision(baseInvoiceNo);
  }

  const { data, error } = await supabase
    .from("invoice_documents")
    .update(updates)
    .eq("id", id)
    .eq("company_code", user.companyCode)
    .select("id, month_yyyy_mm, section, client_name, issue_date, amount, status, invoice_no, counterparty_invoice_address_id, payload, updated_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "請求書の更新に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({
    invoice: {
      id: data.id,
      month: data.month_yyyy_mm,
      section: data.section,
      clientName: data.client_name,
      issueDate: data.issue_date,
      amount: Number(data.amount) || 0,
      status: data.status as InvoiceStatus,
      invoiceNo: data.invoice_no,
      counterpartyInvoiceAddressId: data.counterparty_invoice_address_id,
      payload: data.payload ?? {},
      updatedAt: data.updated_at,
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const { id } = await params;

  const { error } = await supabase
    .from("invoice_documents")
    .delete()
    .eq("id", id)
    .eq("company_code", user.companyCode);

  if (error) {
    return NextResponse.json({ error: "請求書の削除に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
