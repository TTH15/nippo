import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import {
  bumpInvoiceNo,
  isDuplicateInvoiceNo,
  normalizeInvoiceNo,
} from "@/server/billing/invoiceNumbering";
import { storeInvoiceAttachments, signInvoiceAttachments } from "@/server/billing/invoiceAttachments";

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

function isSystemGeneratedInvoice(payload: Record<string, unknown> | undefined): boolean {
  const source = String((payload as any)?.source ?? "");
  if (source === "uploaded_document") return false;
  return true;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requirePermission(req, "can_view_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const { data, error } = await supabase
    .from("invoice_documents")
    .select("id, month_yyyy_mm, section, client_name, issue_date, amount, status, invoice_no, counterparty_invoice_address_id, is_starred, payload, created_at, updated_at")
    .eq("id", id)
    .eq("org_id", orgId)
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
      starred: Boolean((data as any).is_starred),
      counterpartyInvoiceAddressId: data.counterparty_invoice_address_id,
      // 詳細では添付に署名URLを付ける（一覧は実体を持たない）
      payload: (await signInvoiceAttachments(supabase, data.payload ?? {})) ?? {},
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requirePermission(req, "can_manage_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const desiredStatus = body.status;

  // 前置 SELECT の統合: pending_approval 判定・markEdited・invoice_no 変更チェックが
  // それぞれ現在行を読む必要がある。自動保存のたび最大3回直列だったのを1回にまとめる。
  const wantsInvoiceNoUpdate =
    typeof body.invoiceNo === "string" || body.invoiceNo === null || body.markEdited === true;
  let currentRow: { invoice_no: string | null; payload: unknown } | null = null;
  if (desiredStatus === "pending_approval" || wantsInvoiceNoUpdate) {
    const { data, error: curErr } = await supabase
      .from("invoice_documents")
      // payload は pending_approval 判定でのみ必要（重い列のため不要時は読まない）
      .select(desiredStatus === "pending_approval" ? "invoice_no, payload" : "invoice_no")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (curErr) {
      console.error(curErr);
      return NextResponse.json({ error: "請求書の更新に失敗しました" }, { status: 500 });
    }
    currentRow = (data as { invoice_no: string | null; payload?: unknown } | null)
      ? { invoice_no: (data as any).invoice_no ?? null, payload: (data as any).payload }
      : null;
  }

  if (desiredStatus === "pending_approval") {
    if (!currentRow) {
      return NextResponse.json({ error: "請求書の更新に失敗しました" }, { status: 500 });
    }
    const nextPayload =
      body.payload && typeof body.payload === "object"
        ? (body.payload as Record<string, unknown>)
        : ((currentRow.payload as Record<string, unknown>) ?? {});
    const incomingDriverParty = extractIncomingDriverParty(nextPayload);
    const incomingDriverId = extractDriverIdFromParty(incomingDriverParty);
    if (incomingDriverParty && isSystemGeneratedInvoice(nextPayload)) {
      const { data: pendingRows, error: pendingErr } = await supabase
        .from("invoice_documents")
        .select("id, payload")
        .eq("org_id", orgId)
        .eq("status", "pending_approval")
        .eq("driver_id", incomingDriverId)
        .neq("id", id)
        .limit(50);
      if (pendingErr) {
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
  if (typeof body.invoiceNo === "string" || body.invoiceNo === null) {
    updates.invoice_no = body.invoiceNo === null ? null : normalizeInvoiceNo(body.invoiceNo);
  }
  if (typeof body.starred === "boolean") {
    updates.is_starred = body.starred;
  }
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
    // 添付は Storage へ退避し、payload には path だけ残す
    const stored = await storeInvoiceAttachments(supabase, orgId, body.payload as Record<string, unknown>);
    if (!stored.ok) return NextResponse.json({ error: stored.message }, { status: 400 });
    updates.payload = stored.payload;
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
    const baseInvoiceNo =
      typeof currentRow?.invoice_no === "string" && currentRow.invoice_no.trim()
        ? currentRow.invoice_no
        : typeof body.invoiceNo === "string" && body.invoiceNo.trim()
          ? body.invoiceNo.trim()
          : "";
    updates.invoice_no = bumpInvoiceNo(baseInvoiceNo);
  }

  try {
    if ("invoice_no" in updates) {
      const currentNo =
        typeof currentRow?.invoice_no === "string" ? currentRow.invoice_no.trim() : "";
      const nextNo = typeof updates.invoice_no === "string" ? updates.invoice_no.trim() : "";
      // 請求書番号が変更された場合のみ重複チェックする
      if (nextNo && nextNo !== currentNo) {
        const duplicated = await isDuplicateInvoiceNo(
          supabase,
          orgId,
          nextNo,
          id,
        );
        if (duplicated) {
          return NextResponse.json({ error: "請求書番号が重複しています。" }, { status: 409 });
        }
      }
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("invoice_documents")
    .update(updates)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id, month_yyyy_mm, section, client_name, issue_date, amount, status, invoice_no, counterparty_invoice_address_id, is_starred, payload, created_at, updated_at")
    .single();

  if (error || !data) {
    if ((error as any)?.code === "23505") {
      return NextResponse.json({ error: "請求書番号が重複しています。" }, { status: 409 });
    }
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
      starred: Boolean((data as any).is_starred),
      counterpartyInvoiceAddressId: data.counterparty_invoice_address_id,
      payload: data.payload ?? {},
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requirePermission(req, "can_manage_billing");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const { error } = await supabase
    .from("invoice_documents")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);

  if (error) {
    return NextResponse.json({ error: "請求書の削除に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
