import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadActiveReportKinds } from "@/server/reportKinds/config";
import { validateAnswers, normalizeAttachments, type ReportField } from "@/server/reportKinds/fields";

export const dynamic = "force-dynamic";

/** role を持つフィールドの数値を answers から取得（capability/旧カラム互換用）。 */
function roleNumber(fields: ReportField[], answers: Record<string, unknown>, role: "odometer" | "amount"): number | null {
  const f = fields.find((x) => x.role === role);
  if (!f) return null;
  const v = answers[f.id];
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const asStr = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const reportDate = String(body.reportDate ?? "");
    const reportTime = String(body.reportTime ?? "");
    const rawKind = String(body.reportKind ?? "");
    const vehicleId = String(body.vehicleId ?? "");

    const kinds = await loadActiveReportKinds(supabase);
    const kind = kinds.find((k) => k.key === rawKind) ?? kinds[0];
    if (!kind) {
      return NextResponse.json({ error: "報告種別が設定されていません" }, { status: 400 });
    }

    // answers: 新フォーム(answers)優先。無ければ旧bodyフィールドを固定IDへマップ（後方互換）。
    let answers: Record<string, unknown>;
    if (body.answers && typeof body.answers === "object") {
      answers = body.answers as Record<string, unknown>;
    } else {
      answers = {};
      if (body.location !== undefined) answers.f_location = asStr(body.location).trim();
      if (body.description !== undefined) answers.f_description = asStr(body.description).trim();
      if (body.odometerKm !== undefined && body.odometerKm !== "" && body.odometerKm !== null) answers.f_odometer = Number(body.odometerKm);
      if (body.expenseAmount !== undefined && body.expenseAmount !== "" && body.expenseAmount !== null) answers.f_amount = Number(body.expenseAmount);
    }

    const attachments = normalizeAttachments(body.attachments);
    const attachmentsByField: Record<string, number> = {};
    attachments.forEach((a) => (attachmentsByField[a.fieldId] = (attachmentsByField[a.fieldId] ?? 0) + 1));

    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      return NextResponse.json({ error: "reportDate is invalid" }, { status: 400 });
    }
    if (!/^\d{2}:\d{2}$/.test(reportTime)) {
      return NextResponse.json({ error: "reportTime is invalid" }, { status: 400 });
    }
    if (kind.vehicleMode === "required" && !vehicleId) {
      return NextResponse.json({ error: "vehicleId is required" }, { status: 400 });
    }

    // 種別フィールドに基づく回答バリデーション（サーバ＝信頼境界）。
    const result = validateAnswers(kind.fields, answers, attachmentsByField);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    const occurredAt = new Date(`${reportDate}T${reportTime}:00+09:00`);
    if (Number.isNaN(occurredAt.getTime())) {
      return NextResponse.json({ error: "datetime is invalid" }, { status: 400 });
    }

    // 旧カラムへの冗長書き込み（既存の集計・表示・承認の後方互換）。
    const odometerKm = roleNumber(kind.fields, answers, "odometer") ?? (typeof answers.f_odometer === "number" ? answers.f_odometer : null);
    const expenseAmount = roleNumber(kind.fields, answers, "amount") ?? (typeof answers.f_amount === "number" ? answers.f_amount : null);

    // 走行距離の誤入力ガード（オイル交換系）。
    //   入力した走行距離が車両の現在登録より大幅(>=100km)に大きい場合、ドライバーへ確認を促す。
    //   confirmed:true で再送されたら通す（=「正しいですか？」に「はい」）。
    if (kind.capability === "oil_mileage" && vehicleId && odometerKm != null && body.confirmed !== true) {
      const { data: veh } = await supabase
        .from("vehicles")
        .select("current_mileage")
        .eq("id", vehicleId)
        .maybeSingle();
      const current = veh ? Number(veh.current_mileage) || 0 : 0;
      const diff = Math.trunc(odometerKm) - current;
      // current が 0（基準なし）の車両は判定しない（誤検知回避）。
      if (current > 0 && diff >= 100) {
        return NextResponse.json({
          needsConfirm: true,
          currentMileage: current,
          odometer: Math.trunc(odometerKm),
          diff,
          message:
            `入力した走行距離 ${Math.trunc(odometerKm).toLocaleString()} km は、` +
            `現在の登録 ${current.toLocaleString()} km より ${diff.toLocaleString()} km 大きいです。\n` +
            `入力に間違いはありませんか？`,
        });
      }
    }

    const { data, error } = await supabase
      .from("oil_change_reports")
      .insert({
        driver_id: user.driverId,
        report_date: reportDate,
        report_time: reportTime,
        occurred_at: occurredAt.toISOString(),
        location: asStr(answers.f_location).trim(),
        odometer_km: odometerKm,
        report_kind: kind.key,
        description: asStr(answers.f_description).trim(),
        expense_amount: expenseAmount,
        vehicle_id: kind.vehicleMode === "none" ? null : vehicleId || null,
        answers,
        attachments,
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
