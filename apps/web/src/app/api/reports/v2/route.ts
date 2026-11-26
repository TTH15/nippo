import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { isDateOnly, isUuid } from "@/server/db/adminResourceScope";
import { parseParkingReport, prepareParkingReport, saveParkingReport, writeParkingReport } from "@/server/reports/parking";
import { chooseParkingStage, PARKING_STAGE_FIELD, POST_SUBMIT_PARKING_POLICY } from "@/server/reports/postSubmitParking";
import { reportLifecycleError } from "@/server/reports/lifecycleError";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const body = await req.json().catch(() => null);
  const reportDate = body?.reportDate;
  const items = body?.items;
  if (!isDateOnly(reportDate) || !Array.isArray(items) || !items.length || items.length > 100 ||
    typeof body.expectedRevision !== "string" || typeof body.clientKey !== "string" || !body.clientKey || body.clientKey.length > 100 ||
    (body.driverIdentityId != null && !isUuid(body.driverIdentityId)) ||
    items.some(i => !i || !isUuid(i.courseId) || !Number.isInteger(i.cycleNo ?? 0) || (i.cycleNo ?? 0) < 0 ||
      (i.request != null && typeof i.request !== "boolean") || (i.vehicleId != null && !isUuid(i.vehicleId)) ||
      (i.meterValue != null && (!Number.isInteger(i.meterValue) || i.meterValue < 0)) ||
      !Array.isArray(i.entries) || i.entries.length > 200 || i.entries.some((e: any) => !e || !isUuid(e.unitId) ||
        typeof e.fieldKey !== "string" || !e.fieldKey || e.fieldKey.length > 100 ||
        (e.valueNum != null && (typeof e.valueNum !== "number" || !Number.isFinite(e.valueNum))) ||
        (e.valueText != null && (typeof e.valueText !== "string" || e.valueText.length > 2000))))) {
    return NextResponse.json({ error: "日報の内容を確認し、画面を開き直してください" }, { status: 400 });
  }
  const postSubmitParking = body.parkingPolicy === POST_SUBMIT_PARKING_POLICY;
  const requireMapParking = body.parkingPolicy === "required_map";
  const vehicles = [...new Set(items.map(i => i.vehicleId).filter(Boolean))];
  if (postSubmitParking && (vehicles.length > 1 || body.parking != null || body.clientKey.length > 64)) {
    return NextResponse.json({ error: "日報の使用車両を確認してください" }, { status: 400 });
  }
  const parking = body.parking != null ? parseParkingReport(body.parking, { reportDate, itemVehicleIds: items.map(i => i.vehicleId) }) : null;
  if (parking && !parking.ok) return NextResponse.json({ error: parking.error }, { status: 400 });
  if (requireMapParking && vehicles.length && (vehicles.length > 1 || !parking || parking.value.status !== "parked" ||
    (!parking.value.placeId && !parking.value.coords) || (parking.value.placeId && parking.value.coords) ||
    parking.value.detectedBy || parking.value.coords?.fixAt || parking.value.coords?.accuracyM != null || parking.value.clientKey !== body.clientKey)) {
    return NextResponse.json({ error: "車を停めた場所を地図で確認してください" }, { status: 400 });
  }
  const orgId = await resolveOrgId(user.driverId);
  const context = { orgId, driverId: user.driverId, reportDate };
  let prepared: Awaited<ReturnType<typeof prepareParkingReport>> = null;
  if (requireMapParking && parking?.ok) {
    // PWA uses a confirmed site or a manually placed map pin. Do not turn pins into automatic detections.
    const japanDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" });
    const parkingDay = japanDate.format(new Date(parking.value.at));
    const nextReportDay = new Date(new Date(reportDate + "T00:00:00Z").getTime() + 86_400_000).toISOString().slice(0, 10);
    if (!body.parking?.at && reportDate !== japanDate.format(new Date())) {
      return NextResponse.json({ error: "実際に停めた時刻を確認してください" }, { status: 400 });
    }
    if (parkingDay !== reportDate && parkingDay !== nextReportDay) {
      return NextResponse.json({ error: "駐車の時刻は日報の日か翌日にしてください" }, { status: 400 });
    }
    try { prepared = await prepareParkingReport(supabase, parking.value, context, { requireMap: true }); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "駐車場所を確認できませんでした" }, { status: 409 }); }
  }
  let parkingStage: Awaited<ReturnType<typeof chooseParkingStage>> | null = null;
  // No client, including a legacy client, can create the internal receipt marker itself.
  const submittedItems = items.map(item => {
    const clean = { ...item };
    delete clean[PARKING_STAGE_FIELD];
    return clean;
  });
  if (postSubmitParking) {
    try {
      parkingStage = await chooseParkingStage(supabase, context, body.clientKey, (vehicles[0] as string | undefined) ?? null);
      submittedItems[0][PARKING_STAGE_FIELD] = parkingStage;
    } catch {
      return NextResponse.json({ error: "日報を送信できませんでした。もう一度お試しください" }, { status: 503 });
    }
  }
  const { data, error } = await supabase.rpc("submit_report_day", {
    p_org: orgId, p_driver: user.driverId, p_date: reportDate, p_identity: body.driverIdentityId ?? null,
    p_items: submittedItems, p_expected: body.expectedRevision, p_key: body.clientKey,
  });
  if (error) return reportLifecycleError(error, "日報を保存できませんでした。入力を残して再送してください");
  const savedReportIds: string[] = data.reportIds ?? [];
  const savedRequestIds: string[] = data.requestIds ?? [];

  if (postSubmitParking) return NextResponse.json({
    ok: true, reportSaved: true, reportIds: savedReportIds, requestIds: savedRequestIds,
    parkingStage, parkingVehicleId: vehicles[0] ?? null,
  });

  // 車の置き場所。日報が保存できた後に記録する。失敗したら日報は保存済みのまま再送してもらう
  // （client_key で二重登録しない。日報側は (driver,date,course) 単位の上書きなので再送しても増えない）。
  let parkingSaved = false;
  // 座標だけの申告をどの車庫に当てたか。端末の終了サマリーの1行に使う
  let parkingPlaceName: string | null = null;
  // 位置だけ記録できなかった場合。日報は完了しているので再送を求めない
  let parkingUnavailable = false;
  if (parking && parking.ok) {
    try {
      const result = requireMapParking
        ? await writeParkingReport(supabase, prepared)
        : await saveParkingReport(supabase, parking.value, context);
      parkingSaved = result.saved;
      parkingPlaceName = result.snap?.placeName ?? null;
      parkingUnavailable = result.unavailable === true;
      if (requireMapParking && !parkingSaved) throw new Error("駐車場所を記録できませんでした");
    } catch (e) {
      const message = e instanceof Error ? e.message : "駐車場所の保存に失敗しました";
      if (requireMapParking) return NextResponse.json({
        ok: false, reportSaved: true, parkingSaved: false, parkingError: message,
        reportIds: savedReportIds, requestIds: savedRequestIds,
      });
      return NextResponse.json(
        { error: `${message}。日報は保存されています。もう一度送信してください`, reportIds: savedReportIds, reportSaved: true },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, reportIds: savedReportIds, requestIds: savedRequestIds, parkingSaved, parkingPlaceName, parkingUnavailable });
}
