import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { uploadBytes } from "@/server/storage/dataUrl";
import { INVOICE_ATTACHMENT_BUCKET } from "@/server/billing/invoiceAttachments";

export const dynamic = "force-dynamic";

// 運営: 請求書の添付ファイル（PDF/JPG/PNG）を multipart でアップロードし、path を返す。
// 従来はクライアントが base64 data URL（最大約6.7MBのJSON）で invoice POST に同梱し、
// サーバーが Storage へ退避していた（+33%転送・2026-08 監査）。この経路では
// path だけを invoice の payload.attachments に載せて JSON POST する。
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_billing");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "ファイルサイズは5MB以下にしてください。" }, { status: 400 });
    }
    const mime = file.type || "application/octet-stream";
    const bytes = new Uint8Array(await file.arrayBuffer());
    // 中身検査は uploadBytes 側（verifyFileContent）で行う
    const result = await uploadBytes(supabase, INVOICE_ATTACHMENT_BUCKET, orgId, { bytes, mime });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });

    return NextResponse.json({ path: result.path, name: file.name, type: mime, size: file.size });
  } catch (err) {
    console.error("[admin/invoices/attachments] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
