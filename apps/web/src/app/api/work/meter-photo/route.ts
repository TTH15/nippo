import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { checkImage } from "@/server/kyc/storage";
import { uploadMeterPhoto } from "@/server/vehicleQr/meterStorage";

export const dynamic = "force-dynamic";

// POST: メーター写真を非公開 Storage にアップロードし、保存パスを返す。
// 出退勤の確定時にモバイルから呼び、返った path を check-in/out の odometerPhotoPath に渡す。
// body: { base64: string, mime?: string }
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, "DRIVER");
  if (ctx instanceof NextResponse) return ctx;
  const { user, orgId } = ctx;

  try {
    const body = await req.json();
    const base64 = typeof body.base64 === "string" ? body.base64 : "";
    const mime = typeof body.mime === "string" && body.mime ? body.mime : "image/jpeg";
    if (!base64) return NextResponse.json({ error: "画像がありません" }, { status: 400 });

    const bytes = Buffer.from(base64, "base64");
    const check = checkImage(mime, bytes.byteLength);
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });

    const up = await uploadMeterPhoto(supabase, { orgId, driverId: user.driverId }, { bytes, mime });
    if (!up.ok) return NextResponse.json({ error: up.message }, { status: 500 });

    return NextResponse.json({ path: up.path });
  } catch (err) {
    console.error("[work/meter-photo]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
