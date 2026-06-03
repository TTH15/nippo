import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// report.id は v2(daily_reports_v2.id)。読み手(/api/admin/daily/all)が idSource:"v2"
// で返すため、編集も daily_reports_v2 + report_entries(縦持ち) を直接更新する。
// 承認/却下フラグは編集時にリセットし、再承認はモーダル側の approve/reject で行う。

const toInt = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;

/** carrier(code) と各カウントから report_entries の縦持ち行を組み立てる。 */
function buildEntryValues(carrier: "YAMATO" | "AMAZON", body: Record<string, unknown>) {
  const rows: { unitCode: string; fieldKey: string; valueNum: number }[] = [];
  if (carrier === "YAMATO") {
    rows.push(
      { unitCode: "TAKUHAIBIN", fieldKey: "completed", valueNum: toInt(body.takuhaibin_completed) },
      { unitCode: "TAKUHAIBIN", fieldKey: "returned", valueNum: toInt(body.takuhaibin_returned) },
      { unitCode: "NEKOPOS", fieldKey: "completed", valueNum: toInt(body.nekopos_completed) },
      { unitCode: "NEKOPOS", fieldKey: "returned", valueNum: toInt(body.nekopos_returned) },
    );
  } else {
    rows.push(
      { unitCode: "AMAZON_DELIVERY", fieldKey: "am_mochidashi", valueNum: toInt(body.amazon_am_mochidashi) },
      { unitCode: "AMAZON_DELIVERY", fieldKey: "am_completed", valueNum: toInt(body.amazon_am_completed) },
      { unitCode: "AMAZON_DELIVERY", fieldKey: "pm_mochidashi", valueNum: toInt(body.amazon_pm_mochidashi) },
      { unitCode: "AMAZON_DELIVERY", fieldKey: "pm_completed", valueNum: toInt(body.amazon_pm_completed) },
      { unitCode: "AMAZON_DELIVERY", fieldKey: "four_mochidashi", valueNum: toInt(body.amazon_4_mochidashi) },
      { unitCode: "AMAZON_DELIVERY", fieldKey: "four_completed", valueNum: toInt(body.amazon_4_completed) },
    );
  }
  return rows;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id: reportId } = await params;
  if (!reportId) {
    return NextResponse.json({ error: "Report ID required" }, { status: 400 });
  }

  try {
    const body = await req.json();

    const carrier: "YAMATO" | "AMAZON" =
      body.carrier === "AMAZON" ? "AMAZON" : "YAMATO";

    // carrier(code) → carrier_id
    const { data: carrierRow } = await supabase
      .from("carriers")
      .select("id")
      .eq("code", carrier)
      .maybeSingle();

    // ヘッダ更新（編集で承認状態はリセット）
    const updates: Record<string, unknown> = {
      carrier_id: carrierRow?.id ?? null,
      approved_at: null,
      approved_by: null,
      rejected_at: null,
      rejected_by: null,
    };
    if (
      body.report_date !== undefined &&
      typeof body.report_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.report_date)
    ) {
      updates.report_date = body.report_date;
    }

    const { data: updated, error } = await supabase
      .from("daily_reports_v2")
      .update(updates)
      .eq("id", reportId)
      .select("id")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          {
            error:
              "その日付には同一勤務区分の日報が既にあります。別の日付にするか、重複する日報を確認してください。",
          },
          { status: 409 },
        );
      }
      console.error("[admin/daily/reports] update error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json(
        { error: "日報が見つからないか、更新できませんでした。" },
        { status: 404 },
      );
    }

    // report_entries を carrier に合わせて作り直す（縦持ち）
    const entryValues = buildEntryValues(carrier, body);
    const unitCodes = Array.from(new Set(entryValues.map((e) => e.unitCode)));
    const { data: units } = await supabase
      .from("units")
      .select("id, code")
      .in("code", unitCodes);
    const unitIdByCode = new Map<string, string>(
      (units ?? []).map((u: { id: string; code: string }) => [u.code, u.id]),
    );

    const entryRows = entryValues
      .map((e) => {
        const unitId = unitIdByCode.get(e.unitCode);
        return unitId
          ? { report_id: reportId, unit_id: unitId, field_key: e.fieldKey, value_num: e.valueNum }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // 旧 carrier の entry が残らないよう、この report の entry を全削除してから入れ直す
    const { error: delErr } = await supabase
      .from("report_entries")
      .delete()
      .eq("report_id", reportId);
    if (delErr) {
      console.error("[admin/daily/reports] entries delete error", delErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (entryRows.length > 0) {
      const { error: insErr } = await supabase.from("report_entries").insert(entryRows);
      if (insErr) {
        console.error("[admin/daily/reports] entries insert error", insErr);
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/daily/reports] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
