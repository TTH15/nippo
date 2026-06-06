import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadActiveReportKinds } from "@/server/reportKinds/config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const reportDate = String(body.reportDate ?? "");
    const reportTime = String(body.reportTime ?? "");
    const location = String(body.location ?? "").trim();
    const rawKind = String(body.reportKind ?? "");
    const description = String(body.description ?? "").trim();
    const expenseAmountRaw = body.expenseAmount;
    const expenseAmount =
      expenseAmountRaw === "" || expenseAmountRaw === null || expenseAmountRaw === undefined
        ? null
        : Number(expenseAmountRaw);
    const odometerRaw = body.odometerKm;
    const odometerKm =
      odometerRaw === "" || odometerRaw === null || odometerRaw === undefined
        ? null
        : Number(odometerRaw);
    const vehicleId = String(body.vehicleId ?? "");

    // 報告種別マスタ（設定）から該当種別を引く。
    const kinds = await loadActiveReportKinds(supabase);
    const kind = kinds.find((k) => k.key === rawKind) ?? kinds[0];
    if (!kind) {
      return NextResponse.json({ error: "報告種別が設定されていません" }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      return NextResponse.json({ error: "reportDate is invalid" }, { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(reportTime)) {
      return NextResponse.json({ error: "reportTime is invalid" }, { status: 400 });
    }
    if (kind.usesLocation && !location) {
      return NextResponse.json({ error: "location is required" }, { status: 400 });
    }
    if (!vehicleId) {
      return NextResponse.json({ error: "vehicleId is required" }, { status: 400 });
    }

    // 種別が使うフィールドに応じてバリデーション。
    if (kind.usesOdometer) {
      if (odometerKm == null || !Number.isInteger(odometerKm) || odometerKm < 0) {
        return NextResponse.json({ error: "odometerKm must be non-negative integer" }, { status: 400 });
      }
    }
    if (kind.usesDescription && kind.descriptionRequired && description.length < 1) {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }
    if (kind.usesAmount) {
      if (expenseAmount == null || !Number.isInteger(expenseAmount) || expenseAmount <= 0) {
        return NextResponse.json({ error: "expenseAmount must be positive integer" }, { status: 400 });
      }
    }

    const occurredAt = new Date(`${reportDate}T${reportTime}:00+09:00`);
    if (Number.isNaN(occurredAt.getTime())) {
      return NextResponse.json({ error: "datetime is invalid" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("oil_change_reports")
      .insert({
        driver_id: user.driverId,
        report_date: reportDate,
        report_time: reportTime,
        occurred_at: occurredAt.toISOString(),
        location: kind.usesLocation ? location : "",
        odometer_km: kind.usesOdometer ? odometerKm : null,
        report_kind: kind.key,
        description: kind.usesDescription ? description : "",
        expense_amount: kind.usesAmount ? expenseAmount : null,
        vehicle_id: vehicleId,
        submitted_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (error) {
      console.error("[reports/oil-change] insert error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, report: data });
  } catch (err) {
    console.error("[reports/oil-change] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
