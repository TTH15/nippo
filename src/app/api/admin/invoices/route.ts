import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type Section = "Amazon" | "ヤマト運輸" | "郵便局";
type InvoiceStatus = "draft" | "sent" | "paid";

function normalizeMonth(monthParam: string | null): string {
  const now = new Date();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) return monthParam;
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

type SaveBody = {
  id?: string;
  month?: string;
  section?: Section;
  counterpartyInvoiceAddressId?: string | null;
  clientName?: string;
  issueDate?: string | null;
  invoiceNo?: string | null;
  amount?: number;
  status?: InvoiceStatus;
  payload?: Record<string, unknown>;
};

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const monthParam = req.nextUrl.searchParams.get("month");
  const month = monthParam ? normalizeMonth(monthParam) : null;
  let query = supabase
    .from("invoice_documents")
    .select("id, month_yyyy_mm, section, client_name, issue_date, amount, status, invoice_no, counterparty_invoice_address_id, updated_at")
    .eq("company_code", user.companyCode)
    .order("updated_at", { ascending: false });
  if (month) {
    query = query.eq("month_yyyy_mm", month);
  }
  const { data, error } = await query;

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const invoices = (data ?? []).map((r: any) => ({
    id: r.id,
    month: r.month_yyyy_mm,
    section: r.section as Section,
    clientName: r.client_name ?? "",
    issueDate: r.issue_date ?? "",
    amount: Number(r.amount) || 0,
    status: (r.status ?? "draft") as InvoiceStatus,
    invoiceNo: r.invoice_no ?? "",
    counterpartyInvoiceAddressId: r.counterparty_invoice_address_id ?? null,
    updatedAt: r.updated_at ?? null,
  }));

  return NextResponse.json({ month, invoices });
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  let body: SaveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const month = normalizeMonth(body.month ?? null);
  const section: Section =
    body.section === "Amazon" || body.section === "ヤマト運輸" || body.section === "郵便局"
      ? body.section
      : "ヤマト運輸";
  const issueDate =
    typeof body.issueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.issueDate)
      ? body.issueDate
      : null;
  const status: InvoiceStatus =
    body.status === "sent" || body.status === "paid" || body.status === "draft"
      ? body.status
      : "draft";

  const insertRow = {
    company_code: user.companyCode,
    month_yyyy_mm: month,
    section,
    counterparty_invoice_address_id: body.counterpartyInvoiceAddressId ?? null,
    client_name: (body.clientName ?? "").trim(),
    issue_date: issueDate,
    invoice_no: body.invoiceNo ?? null,
    amount: Number(body.amount) || 0,
    status,
    payload: body.payload ?? {},
  };

  const { data, error } = await supabase
    .from("invoice_documents")
    .insert(insertRow)
    .select("id, month_yyyy_mm, section, client_name, issue_date, amount, status, invoice_no, counterparty_invoice_address_id, payload, updated_at")
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    invoice: {
      id: data.id,
      month: data.month_yyyy_mm,
      section: data.section,
      clientName: data.client_name,
      issueDate: data.issue_date,
      amount: Number(data.amount) || 0,
      status: data.status,
      invoiceNo: data.invoice_no,
      counterpartyInvoiceAddressId: data.counterparty_invoice_address_id,
      payload: data.payload ?? {},
      updatedAt: data.updated_at,
    },
  });
}

