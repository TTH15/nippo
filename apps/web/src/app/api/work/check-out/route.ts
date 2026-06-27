import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";
import { resolveScanTarget, parseIntOrNull, normGpsStatus } from "@/server/vehicleQr/session";

export const dynamic = "force-dynamic";

// POST: 退勤打刻（チェックアウト）。★QRは最後（§3-0）。
// メーター・駐車位置・日報など諸入力を済ませた後、最後に車両QRをスキャンして業務終了を確定する。
// スキャン時刻=退勤時刻、スキャン時GPS=駐車位置。スキャンした車両が稼働中セッションの車両と一致することを必須にする。
// body: { sessionId?, method?, token|qr, vehicleId?, odometer?, lat?, lng?, gpsStatus?,
//         platePhotoPath?, fallbackReason?, odometerPhotoPath? }
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, "DRIVER");
  if (ctx instanceof NextResponse) return ctx;
  const { user, orgId } = ctx;
  const body = await req.json().catch(() => ({}));

  // 1) 対象の稼働中セッションを特定（sessionId 指定 or 本人の open）
  let q = supabase
    .from("vehicle_sessions")
    .select("id, vehicle_id, status, recorded_by, start_odometer")
    .eq("recorded_by", user.driverId)
    .eq("status", "open");
  if (body?.sessionId) q = q.eq("id", String(body.sessionId));
  const { data: session } = await q.maybeSingle();

  if (!session) {
    return NextResponse.json(
      { ok: false, code: "no_open_session", message: "稼働中のセッションがありません。" },
      { status: 409 },
    );
  }

  // 2) スキャンした車両がセッションの車両と一致するか（QR/プレート/manual）
  const target = await resolveScanTarget(body, orgId, todayJST());
  if (!target.ok || !target.vehicleId) {
    return NextResponse.json({ ok: false, code: target.code, message: target.message }, { status: 200 });
  }
  if (target.vehicleId !== session.vehicle_id) {
    return NextResponse.json(
      { ok: false, code: "vehicle_mismatch", message: "稼働中の車両と違うQRです。乗っていた車両のQRを読み取ってください。" },
      { status: 200 },
    );
  }

  // 3) 終了メーターの妥当性（巻き戻りは誤読の疑い → 弾く）
  const endOdometer = parseIntOrNull(body?.odometer);
  if (endOdometer !== null && session.start_odometer !== null && endOdometer < session.start_odometer) {
    return NextResponse.json(
      { ok: false, code: "odometer_decreased", message: "終了メーターが開始メーターを下回っています。読み取りを確認してください。" },
      { status: 400 },
    );
  }

  // 4) セッションを閉じる
  const updates: Record<string, unknown> = {
    status: "closed",
    ended_at: new Date().toISOString(),
    end_lat: body?.lat ?? null,
    end_lng: body?.lng ?? null,
    end_odometer: endOdometer,
    end_method: target.method,
    end_gps_status: normGpsStatus(body?.gpsStatus),
  };
  if (target.method !== "qr") {
    updates.fallback_reason = body?.fallbackReason ?? null;
    if (target.method === "plate_ocr") updates.plate_photo_path = body?.platePhotoPath ?? null;
    updates.approval_status = "pending"; // manual/plate での確定は運営承認へ（§8.5）
  }

  const { data: updated, error } = await supabase
    .from("vehicle_sessions")
    .update(updates)
    .eq("id", session.id)
    .eq("status", "open") // 競合ガード
    .select("*")
    .single();

  if (error || !updated) {
    console.error(error);
    return NextResponse.json({ ok: false, error: "Failed to check out" }, { status: 500 });
  }

  // 5) オドメーター写真があれば post 点検として保存（承認まで保持・§7）
  if (body?.odometerPhotoPath) {
    await supabase.from("vehicle_inspections").insert({
      session_id: session.id,
      vehicle_id: session.vehicle_id,
      org_id: orgId,
      recorded_by: user.driverId,
      phase: "post",
      odometer_reading: endOdometer,
      odometer_photo_path: String(body.odometerPhotoPath),
    });
  }

  return NextResponse.json({ ok: true, code: "ok", session: updated });
}
