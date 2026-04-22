import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type Section = "Amazon" | "ヤマト運輸" | "郵便局";
type InvoiceStatus = "draft" | "pending_approval" | "approved" | "paid";
type FolderDirection = "outgoing" | "incoming";

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
  driverId?: string | null;
  issueDate?: string | null;
  invoiceNo?: string | null;
  amount?: number;
  status?: InvoiceStatus;
  payload?: Record<string, unknown>;
};

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

function estimateDataUrlBytes(dataUrl: string): number | null {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.*)$/);
  if (!m?.[2]) return null;
  const b64 = m[2];
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function validateAttachments(payload: Record<string, unknown> | undefined): string | null {
  const attachments = (payload as any)?.attachments;
  if (!Array.isArray(attachments)) return null;
  for (const item of attachments) {
    const type = String(item?.type || "").toLowerCase();
    const name = String(item?.name || "").toLowerCase();
    const dataUrl = String(item?.dataUrl || "");
    const mimeOk =
      ALLOWED_ATTACHMENT_MIME.has(type) ||
      name.endsWith(".pdf") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".png");
    if (!mimeOk) {
      return "添付ファイルは PDF / JPG / PNG のみ対応しています。";
    }
    if (dataUrl) {
      const bytes = estimateDataUrlBytes(dataUrl);
      if (bytes !== null && bytes > MAX_ATTACHMENT_BYTES) {
        return "添付ファイルのサイズは5MB以下にしてください。";
      }
    }
  }
  return null;
}

function extractIncomingDriverParty(payload: Record<string, unknown> | undefined): string | null {
  const parties = (payload as any)?.parties;
  if (!parties) return null;
  if (parties.toParty !== "ace_creation") return null;
  const fromParty = String(parties.fromParty ?? "");
  if (!fromParty.startsWith("drv-")) return null;
  return fromParty;
}

function extractDriverIdFromParty(fromParty: string | null): string | null {
  if (!fromParty) return null;
  if (!fromParty.startsWith("drv-")) return null;
  const id = fromParty.slice("drv-".length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

function isSystemGeneratedInvoice(payload: Record<string, unknown> | undefined): boolean {
  const source = String((payload as any)?.source ?? "");
  if (source === "uploaded_document") return false;
  return true;
}

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const monthParam = req.nextUrl.searchParams.get("month");
  const month = monthParam ? normalizeMonth(monthParam) : null;
  let query = supabase
    .from("invoice_documents")
    .select("id, month_yyyy_mm, section, client_name, issue_date, amount, status, invoice_no, counterparty_invoice_address_id, updated_at, payload")
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
    direction:
      r?.payload?.parties?.toParty === "ace_creation"
        ? ("incoming" as FolderDirection)
        : ("outgoing" as FolderDirection),
    // 一覧上の取引先名は DB の client_name を正とする（表示名揺れを避ける）
    counterpartyName:
      (typeof r?.client_name === "string" && r.client_name.trim()) ||
      (r?.payload?.parties?.toParty === "ace_creation"
        ? (r?.payload?.fromName ?? "未設定")
        : (r?.payload?.toName ?? "未設定")),
    id: r.id,
    month: r.month_yyyy_mm,
    section: r.section as Section,
    clientName: r.client_name ?? "",
    issueDate: r.issue_date ?? "",
    amount: Number(r.amount) || 0,
    status: ((r.status === "sent" ? "pending_approval" : r.status) ?? "draft") as InvoiceStatus,
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
    body.status === "pending_approval" ||
    body.status === "approved" ||
    body.status === "paid" ||
    body.status === "draft"
      ? body.status
      : "draft";
  const incomingDriverParty = extractIncomingDriverParty(body.payload);
  const incomingDriverId = extractDriverIdFromParty(incomingDriverParty);
  const attachmentError = validateAttachments(body.payload);
  if (attachmentError) {
    return NextResponse.json({ error: attachmentError }, { status: 400 });
  }

  // incoming（自社に請求）のドライバー起点請求書は driver_id を必須とする
  if (incomingDriverParty) {
    const driverId =
      (typeof body.driverId === "string" && body.driverId) || incomingDriverId;
    if (!driverId) {
      return NextResponse.json({ error: "driver_id is required" }, { status: 400 });
    }
    if (incomingDriverId && driverId !== incomingDriverId) {
      return NextResponse.json({ error: "driver_id mismatch" }, { status: 400 });
    }
  }

  // 承認待ち1件制約は「システム作成請求書」のみ適用
  if (status === "pending_approval" && incomingDriverParty && isSystemGeneratedInvoice(body.payload)) {
    const { data: pendingRows, error: pendingErr } = await supabase
      .from("invoice_documents")
      .select("id, payload")
      .eq("company_code", user.companyCode)
      .eq("status", "pending_approval")
      .eq("driver_id", incomingDriverId)
      .limit(50);
    if (pendingErr) {
      console.error(pendingErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    const hasSystemPending = (pendingRows ?? []).some((row: any) =>
      isSystemGeneratedInvoice((row?.payload ?? {}) as Record<string, unknown>)
    );
    if (hasSystemPending) {
      return NextResponse.json(
        { error: "このドライバーには既に承認待ちのシステム請求書があります。" },
        { status: 409 },
      );
    }
  }

  const insertRow = {
    company_code: user.companyCode,
    month_yyyy_mm: month,
    section,
    driver_id:
      (typeof body.driverId === "string" && body.driverId) || incomingDriverId || null,
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

