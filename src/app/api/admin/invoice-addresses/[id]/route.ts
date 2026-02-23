import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// PUT: 法人アドレス更新
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { name, postalCode, address, phone, invoiceNo } = body;
    const { id } = await params;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = typeof name === "string" ? name.trim() : null;
    if (postalCode !== undefined) updates.postal_code = typeof postalCode === "string" ? postalCode.trim() || null : null;
    if (address !== undefined) updates.address = typeof address === "string" ? address.trim() || null : null;
    if (phone !== undefined) updates.phone = typeof phone === "string" ? phone.trim() || null : null;
    if (invoiceNo !== undefined) updates.invoice_no = typeof invoiceNo === "string" ? invoiceNo.trim() || null : null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "更新する項目がありません" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("invoice_addresses")
      .update(updates)
      .eq("id", id)
      .eq("company_code", user.companyCode)
      .select()
      .single();

    if (error) {
      console.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ address: data });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE: 法人アドレス削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id } = await params;

  const { error } = await supabase
    .from("invoice_addresses")
    .delete()
    .eq("id", id)
    .eq("company_code", user.companyCode);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
