import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const { id } = await params;

  const { data: invoice, error: fetchErr } = await supabase
    .from("invoice_documents")
    .select("id, status, payload, driver_id")
    .eq("id", id)
    .eq("company_code", user.companyCode)
    .maybeSingle();

  if (fetchErr || !invoice) {
    return NextResponse.json({ error: "請求書が見つかりません" }, { status: 404 });
  }

  if ((invoice as any)?.driver_id !== user.driverId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = (invoice as any).status;
  if (status !== "pending_approval" && status !== "sent") {
    return NextResponse.json({ error: "承認待ちの請求書ではありません" }, { status: 400 });
  }

  const { error } = await supabase
    .from("invoice_documents")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_code", user.companyCode);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

