import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";
import { resolveScanTarget, parseIntOrNull, normGpsStatus } from "@/server/vehicleQr/session";

export const dynamic = "force-dynamic";

// POST: 出勤打刻（チェックイン）。車両QRが先頭（§2）。
// 車両を特定→認可→既存の稼働中セッションが無いことを確認→ open セッションを作成。
// manual 打刻（QR/プレート両不可）は運営承認制＝approval_status='pending'（§8.5）。
// body: { method?, token|qr, vehicleId?, purpose?, odometer?, lat?, lng?, gpsStatus?,
//         shiftId?, platePhotoPath?, fallbackReason?, odometerPhotoPath? }
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, "DRIVER");
  if (ctx instanceof NextResponse) return ctx;
  const { user, orgId } = ctx;
  const body = await req.json().catch(() => ({}));

  // 1) 車両を特定・認可（QR / プレート / manual を吸収）
  const target = await resolveScanTarget(body, orgId, todayJST());
  if (!target.ok || !target.vehicleId) {
    // スキャン拒否は理由付きで返す（退避ルート誘導は app 側）
    return NextResponse.json({ ok: false, code: target.code, message: target.message }, { status: 200 });
  }

  // 2) 既に稼働中のセッションがあれば二重出勤を防ぐ（app は resume/退勤へ）
  const { data: openS } = await supabase
    .from("vehicle_sessions")
    .select("id, vehicle_id, started_at")
    .eq("recorded_by", user.driverId)
    .eq("status", "open")
    .maybeSingle();
  if (openS) {
    return NextResponse.json(
      { ok: false, code: "already_open", message: "すでに稼働中のセッションがあります。先に退勤してください。", session: openS },
      { status: 409 },
    );
  }

  // 3) open セッション作成
  const purpose = body?.purpose === "move" || body?.purpose === "private" ? body.purpose : "work";
  const startOdometer = parseIntOrNull(body?.odometer);
  const approvalStatus = target.method === "manual" ? "pending" : null;

  const { data: session, error } = await supabase
    .from("vehicle_sessions")
    .insert({
      vehicle_id: target.vehicleId,
      org_id: orgId, // 使用org（貸与中は借用org＝requester）
      recorded_by: user.driverId,
      purpose,
      shift_id: body?.shiftId ? String(body.shiftId) : null,
      status: "open",
      started_at: new Date().toISOString(),
      start_lat: body?.lat ?? null,
      start_lng: body?.lng ?? null,
      start_odometer: startOdometer,
      start_method: target.method,
      start_gps_status: normGpsStatus(body?.gpsStatus),
      fallback_reason: target.method !== "qr" ? (body?.fallbackReason ?? null) : null,
      plate_photo_path: target.method === "plate_ocr" ? (body?.platePhotoPath ?? null) : null,
      approval_status: approvalStatus,
    })
    .select("*")
    .single();

  if (error || !session) {
    console.error(error);
    return NextResponse.json({ ok: false, error: "Failed to check in" }, { status: 500 });
  }

  // 4) オドメーター写真があれば pre 点検として保存（承認まで保持・§7）
  if (body?.odometerPhotoPath) {
    await supabase.from("vehicle_inspections").insert({
      session_id: session.id,
      vehicle_id: target.vehicleId,
      org_id: orgId,
      recorded_by: user.driverId,
      phase: "pre",
      odometer_reading: startOdometer,
      odometer_photo_path: String(body.odometerPhotoPath),
    });
  }

  return NextResponse.json({ ok: true, code: "ok", usage: target.usage, session });
}
