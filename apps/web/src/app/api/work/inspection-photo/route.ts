import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { checkImage } from "@/server/kyc/storage";
import { uploadInspectionPhoto } from "@/server/vehicleQr/inspectionStorage";

export const dynamic = "force-dynamic";

// POST: 車両点検写真（前後左右4方向）を非公開 Storage にアップロードし、保存パスを返す。
// 出退勤の確定時にモバイルから角度ごとに呼び、返った path を check-in/out の inspectionPhotos に渡す。
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

    const up = await uploadInspectionPhoto(supabase, { orgId, driverId: user.driverId }, { bytes, mime });
    if (!up.ok) return NextResponse.json({ error: up.message }, { status: 500 });

    return NextResponse.json({ path: up.path });
  } catch (err) {
    console.error("[work/inspection-photo]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
