import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { parseParkingReport, saveParkingReport } from "@/server/reports/parking";
import { hasParkingInspectionPhotos } from "@/server/vehicleQr/inspectionPolicy";
import { METER_BUCKET } from "@/server/vehicleQr/meterStorage";
import { isStoredPathInScope } from "@/server/storage/scope";
import { parseInspectionPhotos } from "@/server/vehicleQr/session";
import { loadPhotoCaptureTasks, validateStagePhotos } from "@/server/vehicleQr/photoCaptureTasks";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req, "DRIVER");
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return NextResponse.json({ error: "sessionId が不正です" }, { status: 400 });
  const { data: session, error } = await supabase.from("vehicle_sessions")
    .select("id, vehicle_id, status, purpose, ended_at")
    .eq("id", sessionId).eq("org_id", ctx.orgId).eq("recorded_by", ctx.user.driverId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "稼働を確認できませんでした" }, { status: 500 });
  if (!session || session.purpose !== "work" || session.status !== "closed" || !session.ended_at) {
    return NextResponse.json({ error: "業務終了後に駐車を記録してください" }, { status: 409 });
  }
  const { data: inspections, error: inspectionError } = await supabase.from("vehicle_inspections")
    .select("id, created_at")
    .eq("session_id", sessionId).eq("org_id", ctx.orgId).eq("recorded_by", ctx.user.driverId).eq("phase", "post")
    .order("created_at", { ascending: false });
  if (inspectionError) return NextResponse.json({ error: "点検写真を確認できませんでした" }, { status: 500 });
  const inspectionIds = (inspections ?? []).map(row => row.id);
  if (inspectionIds.length === 0) return NextResponse.json({ error: "車両の点検写真を先に送信してください" }, { status: 409 });
  const { data: photos, error: photoError } = await supabase.from("vehicle_inspection_photos")
    .select("inspection_id, angle, photo_path").in("inspection_id", inspectionIds);
  if (photoError) return NextResponse.json({ error: "点検写真を確認できませんでした" }, { status: 500 });
  const completedInspection = (inspections ?? []).find(inspection =>
    hasParkingInspectionPhotos((photos ?? []).filter(photo => photo.inspection_id === inspection.id)));
  if (!completedInspection) {
    return NextResponse.json({ error: "車両の前・右・後・左の点検写真を先に送信してください" }, { status: 409 });
  }
  const meterPhotoPath = typeof body.odometerPhotoPath === "string" ? body.odometerPhotoPath : "";
  if (!isStoredPathInScope(meterPhotoPath, `${ctx.orgId}/${ctx.user.driverId}`)) {
    return NextResponse.json({ error: "駐車時のメーター写真を撮影してください" }, { status: 400 });
  }
  const { data: meterFile, error: meterError } = await supabase.storage.from(METER_BUCKET).info(meterPhotoPath);
  if (meterError || !meterFile) return NextResponse.json({ error: "メーター写真を確認できませんでした" }, { status: 409 });
  const additionalPhotos = parseInspectionPhotos(body.additionalPhotos);
  const rawPhotoCount = Array.isArray(body.additionalPhotos) ? body.additionalPhotos.length : 0;
  if (rawPhotoCount !== additionalPhotos.length || additionalPhotos.some(photo => !photo.angle.startsWith("extra:"))) {
    return NextResponse.json({ error: "追加写真を確認できませんでした" }, { status: 400 });
  }
  const tasks = await loadPhotoCaptureTasks(ctx.orgId);
  if (!tasks) return NextResponse.json({ error: "撮影項目を確認できませんでした" }, { status: 500 });
  const additionalError = await validateStagePhotos({ orgId: ctx.orgId, driverId: ctx.user.driverId, stage: "parking", photos: additionalPhotos, tasks });
  if (additionalError) return NextResponse.json({ error: additionalError }, { status: 409 });
  const reportDate = new Date(session.ended_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const parsed = parseParkingReport({
    vehicleId: session.vehicle_id,
    status: "parked",
    clientKey: `${sessionId}:parking`,
    at: new Date().toISOString(),
    coords: body.coords,
    detectedBy: "session_end",
  }, { reportDate, itemVehicleIds: [session.vehicle_id] });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    if (additionalPhotos.length) {
      const { data: storedExtras, error: storedError } = await supabase.from("vehicle_inspection_photos")
        .select("id, angle, photo_path").eq("inspection_id", completedInspection.id).in("angle", additionalPhotos.map(photo => photo.angle));
      if (storedError) return NextResponse.json({ error: "追加写真を確認できませんでした" }, { status: 500 });
      for (const photo of additionalPhotos) {
        const stored = (storedExtras ?? []).find(row => row.angle === photo.angle);
        if (stored?.photo_path === photo.path) continue;
        const write = stored
          ? await supabase.from("vehicle_inspection_photos").update({ photo_path: photo.path }).eq("id", stored.id)
          : await supabase.from("vehicle_inspection_photos").insert({ inspection_id: completedInspection.id, angle: photo.angle, photo_path: photo.path });
        if (write.error) return NextResponse.json({ error: "追加写真を記録できませんでした" }, { status: 500 });
      }
    }
    const { error: meterSaveError } = await supabase.from("vehicle_inspections")
      .update({ odometer_photo_path: meterPhotoPath })
      .eq("id", completedInspection.id).eq("org_id", ctx.orgId).eq("recorded_by", ctx.user.driverId);
    if (meterSaveError) return NextResponse.json({ error: "メーター写真を記録できませんでした" }, { status: 500 });
    const result = await saveParkingReport(supabase, parsed.value, {
      orgId: ctx.orgId, driverId: ctx.user.driverId, reportDate,
    });
    if (!result.saved) return NextResponse.json({ error: "車の位置を記録できませんでした" }, { status: 503 });
    return NextResponse.json({ parkingSaved: true, parkingPlaceName: result.snap?.placeName ?? null });
  } catch (e) {
    console.error("[work/parking] save failed", e);
    return NextResponse.json({ error: "車の位置を記録できませんでした" }, { status: 500 });
  }
}
