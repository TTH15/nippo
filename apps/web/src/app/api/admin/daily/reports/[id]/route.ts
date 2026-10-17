import { validateReportFieldWrites } from "@/server/reports/validateFieldWrites";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { syncReportEntries } from "@/server/reports/entries";

export const dynamic = "force-dynamic";

// report.id は v2(daily_reports_v2.id)。読み手(/api/admin/daily/all 等)が idSource:"v2"
// で返すため、編集も daily_reports_v2 + report_entries(縦持ち) を直接更新する。
// 編集は送信画面と同じ動的フォーム（unit/field）に対応：body.entries で縦持ちの値を受け取る。
// 承認/却下フラグは編集時にリセットし、再承認はモーダル側の approve/reject で行う。
// キャリア/コースは日報に紐付く固定値のため、ここでは変更しない。

type EntryInput = {
  unitId?: string;
  fieldKey?: string;
  valueNum?: number | null;
  valueText?: string | null;
};

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requirePermission(req, "can_edit_reports");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { id: reportId } = await params;
  if (!reportId) {
    return NextResponse.json({ error: "Report ID required" }, { status: 400 });
  }

  try {
    const body = await req.json();

    const { data: before, error: beforeError } = await supabase.from("daily_reports_v2")
      .select("id, course_id, cycle_no, rejection_reason").eq("org_id", orgId).eq("id", reportId).maybeSingle();
    if (beforeError) throw beforeError;
    if (!before) return NextResponse.json({ error: "日報が見つかりません" }, { status: 404 });
    if (before.rejection_reason === "shift_changed") return NextResponse.json({ error: "シフト変更で対象外になった日報です。現在のシフトから入力してください。" }, { status: 409 });
    if (before.course_id && Array.isArray(body.entries)) {
      const fieldError = await validateReportFieldWrites(supabase, orgId, [{ courseId: before.course_id, cycleNo: before.cycle_no, entries: body.entries }], [before], true);
      if (fieldError) return NextResponse.json({ error: fieldError }, { status: 409 });
    }

    // ヘッダ更新（編集で承認状態はリセット。carrier_id/course_id は変更しない）
    const updates: Record<string, unknown> = {
      approved_at: null,
      approved_by: null,
      rate_snapshot: null,
      rejected_at: null,
      rejected_by: null,
      rejection_reason: null,
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
      .eq("org_id", orgId)
      .select("id")
      .maybeSingle();

    if (error) {
      if (error.code === "23514" && error.message.includes("シフトが変更")) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
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

    // entries が配列で渡されたときのみ report_entries を差分同期する（縦持ち）。
    // 未指定（undefined）なら項目は変更しない。
    if (Array.isArray(body.entries)) {
      const entryRows = (body.entries as EntryInput[])
        .filter((e) => e.unitId && e.fieldKey)
        .map((e) => ({
          report_id: reportId,
          unit_id: e.unitId as string,
          field_key: e.fieldKey as string,
          value_num: typeof e.valueNum === "number" ? e.valueNum : null,
          value_text: e.valueText != null ? String(e.valueText) : null,
        }));

      try {
        // 差分 upsert（変わった項目だけ書く。全削除→全挿入を廃止・2026-08 監査）
        await syncReportEntries(supabase, orgId, reportId, entryRows);
      } catch (e) {
        console.error("[admin/daily/reports] entries sync error", e);
        if (e && typeof e === "object" && "code" in e && e.code === "23514") {
          return NextResponse.json({ error: "日報項目が変更されています。再読み込みして確認してください。" }, { status: 409 });
        }
        return NextResponse.json({ error: "DB error" }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/daily/reports] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
