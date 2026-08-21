import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { removeStoredPaths, resolveStoredUrl, uploadDataUrl } from "@/server/storage/dataUrl";
import { companies } from "@/config/companies";

export const dynamic = "force-dynamic";
const BUCKET = "organization-assets";
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function load(orgId: string) {
  return supabase.from("organizations").select(
    "id, code, name, invoice_postal_code, invoice_address, invoice_tel, invoice_registration_no, invoice_bank_name, invoice_bank_no, invoice_bank_holder, invoice_stamp_path",
  ).eq("id", orgId).maybeSingle();
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { data, error } = await load(orgId);
  if (error || !data) return NextResponse.json({ error: "会社設定を取得できません" }, { status: 500 });
  const storedStampUrl = await resolveStoredUrl(supabase, BUCKET, data.invoice_stamp_path, 60 * 60 * 8);
  // migration直後もACEの既存社印を維持し、UIからアップロード後はStorageを正本にする。
  const stampUrl = storedStampUrl ?? (data.code === "ACE" ? companies.ACE.invoiceIssuer.stampPath : null);
  return NextResponse.json({ settings: { ...data, stampUrl } });
}

export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const body = await req.json().catch(() => ({}));
  const { data: current } = await load(orgId);
  if (!current) return NextResponse.json({ error: "会社設定が見つかりません" }, { status: 404 });

  let stampPath: string | null = current.invoice_stamp_path ?? null;
  if (body.removeStamp === true) stampPath = null;
  if (typeof body.stampDataUrl === "string" && body.stampDataUrl) {
    if (body.stampDataUrl.length > 3_000_000) {
      return NextResponse.json({ error: "社印画像は2MB以下にしてください" }, { status: 400 });
    }
    const uploaded = await uploadDataUrl(supabase, BUCKET, orgId, body.stampDataUrl, ["image/png", "image/jpeg", "image/webp"]);
    if (!uploaded.ok) return NextResponse.json({ error: uploaded.message }, { status: 400 });
    stampPath = uploaded.path;
  }

  const { error } = await supabase.from("organizations").update({
    name: text(body.name, 120) || current.name,
    invoice_postal_code: text(body.invoicePostalCode, 20) || null,
    invoice_address: text(body.invoiceAddress, 300) || null,
    invoice_tel: text(body.invoiceTel, 40) || null,
    invoice_registration_no: text(body.invoiceRegistrationNo, 40) || null,
    invoice_bank_name: text(body.invoiceBankName, 120) || null,
    invoice_bank_no: text(body.invoiceBankNo, 120) || null,
    invoice_bank_holder: text(body.invoiceBankHolder, 120) || null,
    invoice_stamp_path: stampPath,
  }).eq("id", orgId);
  if (error) return NextResponse.json({ error: "会社設定を保存できません" }, { status: 500 });

  if (current.invoice_stamp_path && current.invoice_stamp_path !== stampPath) {
    await removeStoredPaths(supabase, BUCKET, [current.invoice_stamp_path]);
  }
  return GET(req);
}
