import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 法人アドレス一覧（会社コードでフィルタ）
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { data, error } = await supabase
    .from("invoice_addresses")
    .select("id, name, postal_code, address, phone, invoice_no, created_at")
    .eq("company_code", user.companyCode)
    .order("name");

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ addresses: data ?? [] });
}

// POST: 法人アドレス新規登録
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { name, postalCode, address, phone, invoiceNo } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "会社名を入力してください" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("invoice_addresses")
      .insert({
        company_code: user.companyCode,
        name: name.trim(),
        postal_code: typeof postalCode === "string" ? postalCode.trim() || null : null,
        address: typeof address === "string" ? address.trim() || null : null,
        phone: typeof phone === "string" ? phone.trim() || null : null,
        invoice_no: typeof invoiceNo === "string" ? invoiceNo.trim() || null : null,
      })
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
