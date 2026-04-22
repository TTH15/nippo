import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type InvoiceStatus = "draft" | "pending_approval" | "approved" | "paid";

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
      status: ((data.status as string) === "sent" ? "pending_approval" : data.status) as InvoiceStatus,
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

  const desiredStatus = body.status;
  if (desiredStatus === "pending_approval") {
    const { data: current, error: curErr } = await supabase
      .from("invoice_documents")
      .select("id, payload")
      .eq("id", id)
      .eq("company_code", user.companyCode)
      .maybeSingle();
    if (curErr || !current) {
      return NextResponse.json({ error: "請求書の更新に失敗しました" }, { status: 500 });
    }
    const nextPayload =
      body.payload && typeof body.payload === "object"
        ? (body.payload as Record<string, unknown>)
        : ((current.payload as Record<string, unknown>) ?? {});
    const incomingDriverParty = extractIncomingDriverParty(nextPayload);
    const incomingDriverId = extractDriverIdFromParty(incomingDriverParty);
    if (incomingDriverParty) {
      const { data: existing, error: pendingErr } = await supabase
        .from("invoice_documents")
        .select("id")
        .eq("company_code", user.companyCode)
        .eq("status", "pending_approval")
        .eq("driver_id", incomingDriverId)
        .neq("id", id)
        .limit(1)
        .maybeSingle();
      if (pendingErr) {
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
      if (existing?.id) {
        return NextResponse.json(
          { error: "このドライバーには既に承認待ちの請求書があります。" },
          { status: 409 },
        );
      }
    }
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const payloadForValidation =
    body.payload && typeof body.payload === "object"
      ? (body.payload as Record<string, unknown>)
      : undefined;
  const attachmentError = validateAttachments(payloadForValidation);
  if (attachmentError) {
    return NextResponse.json({ error: attachmentError }, { status: 400 });
  }
  if (typeof body.clientName === "string") updates.client_name = body.clientName.trim();
  if (typeof body.driverId === "string" || body.driverId === null) updates.driver_id = body.driverId;
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
  if (body.status === "draft" || body.status === "pending_approval" || body.status === "approved" || body.status === "paid") {
    updates.status = body.status;
  }
  if (typeof body.section === "string" && (body.section === "Amazon" || body.section === "ヤマト運輸" || body.section === "郵便局")) {
    updates.section = body.section;
  }
  if (body.payload && typeof body.payload === "object") {
    updates.payload = body.payload;
  }

  // incoming（自社に請求）のドライバー起点請求書は driver_id を必須とする
  if (updates.payload && typeof updates.payload === "object") {
    const incomingDriverParty = extractIncomingDriverParty(updates.payload as Record<string, unknown>);
    const incomingDriverId = extractDriverIdFromParty(incomingDriverParty);
    if (incomingDriverParty) {
      const driverId =
        typeof updates.driver_id === "string" && updates.driver_id
          ? (updates.driver_id as string)
          : incomingDriverId;
      if (!driverId) {
        return NextResponse.json({ error: "driver_id is required" }, { status: 400 });
      }
      if (incomingDriverId && driverId !== incomingDriverId) {
        return NextResponse.json({ error: "driver_id mismatch" }, { status: 400 });
      }
      updates.driver_id = driverId;
    }
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
      status: ((data.status as string) === "sent" ? "pending_approval" : data.status) as InvoiceStatus,
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
