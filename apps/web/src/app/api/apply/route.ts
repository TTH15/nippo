import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// 公開: 運営社オンボーディング申請（/apply フォームの受け口）。
// Webフォーム即発行はしない（§2-5）— ここでは台帳に載せるだけで、審査・承認はプラットフォームコンソール側。

const MAX = 500;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // ハニーポット（画面には出さない入力。bot が埋めたら黙って捨てる）
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, MAX) : null);

  const companyName = s(body.companyName);
  const contactEmail = s(body.contactEmail);
  if (!companyName || !contactEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    return NextResponse.json({ error: "会社名と連絡先メールアドレスは必須です" }, { status: 400 });
  }

  const { error } = await supabase.from("org_applications").insert({
    company_name: companyName,
    corporate_number: s(body.corporateNumber),
    representative: s(body.representative),
    contact_name: s(body.contactName),
    contact_email: contactEmail,
    contact_phone: s(body.contactPhone),
    address: s(body.address),
    message: s(body.message),
  });
  if (error) {
    console.error("[apply]", error);
    return NextResponse.json({ error: "送信に失敗しました。時間をおいてもう一度お試しください。" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
