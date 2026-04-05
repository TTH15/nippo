import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mergeId: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id: invoiceAddressId, mergeId } = await params;
  let body: { description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.description !== "string") {
    return NextResponse.json({ error: "description が必要です" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("counterparty_monthly_merged_lines")
    .update({ description: body.description.trim() })
    .eq("id", mergeId)
    .eq("company_code", user.companyCode)
    .eq("invoice_address_id", invoiceAddressId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "統合行が見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mergeId: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id: invoiceAddressId, mergeId } = await params;

  const { error } = await supabase
    .from("counterparty_monthly_merged_lines")
    .delete()
    .eq("id", mergeId)
    .eq("company_code", user.companyCode)
    .eq("invoice_address_id", invoiceAddressId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
