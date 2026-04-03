import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

const REPORT_KINDS = ["oil_change", "repair", "one_off", "other"] as const;
type ReportKind = (typeof REPORT_KINDS)[number];

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const reportDate = String(body.reportDate ?? "");
    const reportTime = String(body.reportTime ?? "");
    const location = String(body.location ?? "").trim();
    const rawKind = String(body.reportKind ?? "oil_change");
    const reportKind: ReportKind = REPORT_KINDS.includes(rawKind as ReportKind)
      ? (rawKind as ReportKind)
      : "oil_change";
    const description = String(body.description ?? "").trim();
    const odometerRaw = body.odometerKm;
    const odometerKm =
      odometerRaw === "" || odometerRaw === null || odometerRaw === undefined
        ? null
        : Number(odometerRaw);
    const vehicleId = String(body.vehicleId ?? "");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      return NextResponse.json({ error: "reportDate is invalid" }, { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(reportTime)) {
      return NextResponse.json({ error: "reportTime is invalid" }, { status: 400 });
    }
    if (!location) {
      return NextResponse.json({ error: "location is required" }, { status: 400 });
    }
    if (!vehicleId) {
      return NextResponse.json({ error: "vehicleId is required" }, { status: 400 });
    }

    if (reportKind === "oil_change") {
      if (odometerKm == null || !Number.isInteger(odometerKm) || odometerKm < 0) {
        return NextResponse.json({ error: "odometerKm must be non-negative integer" }, { status: 400 });
      }
    } else {
      if (description.length < 1) {
        return NextResponse.json({ error: "description is required" }, { status: 400 });
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
        location,
        odometer_km: reportKind === "oil_change" ? odometerKm : null,
        report_kind: reportKind,
        description: reportKind === "oil_change" ? "" : description,
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
