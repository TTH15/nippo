import { supabase } from "@/server/db/client";
import { resolveOrgId } from "@/server/db/tenant";

// ============================================================
// 移行期の整合ヘルパ: 旧 daily_reports ⇄ 新 daily_reports_v2 を同期。
//   ドライバーは当面 旧 /submit を使い、運営は旧 daily 画面で承認するため、
//   それらの結果を v2(+report_entries) に反映して、新モデル集計を正しく保つ。
//   v2 側は legacy_report_id で旧行と1:1リンク。
// ============================================================

type LegacyReport = {
  id: string;
  driver_id: string;
  driver_identity_id: string | null;
  report_date: string;
  carrier: string; // 'YAMATO' | 'AMAZON'
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
  amazon_am_mochidashi: number;
  amazon_am_completed: number;
  amazon_pm_mochidashi: number;
  amazon_pm_completed: number;
  amazon_4_mochidashi: number;
  amazon_4_completed: number;
  vehicle_id: string | null;
  meter_value: number | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
};

const n = (v: unknown) => Number(v) || 0;

/** 旧 daily_reports 1行 → daily_reports_v2 + report_entries に upsert（best-effort）。 */
export async function syncLegacyReportToV2(r: LegacyReport): Promise<void> {
  // carrier_id
  const { data: carrier } = await supabase.from("carriers").select("id").eq("code", r.carrier).maybeSingle();
  const carrierId = (carrier as any)?.id ?? null;

  // course_id: 同日同ドライバーの shift で、コースの carrier が一致するもの
  let courseId: string | null = null;
  const { data: shiftRows } = await supabase
    .from("shifts")
    .select("course_id, created_at, courses(carrier)")
    .eq("driver_id", r.driver_id)
    .eq("shift_date", r.report_date)
    .order("created_at");
  for (const s of shiftRows ?? []) {
    const cCarrier = (s as any).courses?.carrier;
    if (cCarrier === r.carrier) {
      courseId = (s as any).course_id;
      break;
    }
  }
  if (!courseId && (shiftRows ?? []).length > 0) courseId = (shiftRows as any[])[0].course_id;

  // unit ids by code
  const { data: units } = await supabase.from("units").select("id, code").in("code", ["TAKUHAIBIN", "NEKOPOS", "AMAZON_DELIVERY"]);
  const unitByCode = new Map<string, string>((units ?? []).map((u: any) => [u.code, u.id]));

  const header = {
    org_id: await resolveOrgId(r.driver_id),
    driver_id: r.driver_id,
    report_date: r.report_date,
    course_id: courseId,
    carrier_id: carrierId,
    identity_id: r.driver_identity_id,
    vehicle_id: r.vehicle_id,
    meter_value: r.meter_value,
    submitted_at: r.submitted_at,
    approved_at: r.approved_at,
    approved_by: r.approved_by,
    rejected_at: r.rejected_at,
    rejected_by: r.rejected_by,
    legacy_report_id: r.id,
  };

  // 既存 v2（legacy_report_id 一致）を探して update / insert
  const { data: existing } = await supabase
    .from("daily_reports_v2")
    .select("id")
    .eq("legacy_report_id", r.id)
    .maybeSingle();

  let reportId: string;
  let isExisting = false;
  if (existing?.id) {
    await supabase.from("daily_reports_v2").update(header).eq("id", existing.id);
    reportId = existing.id;
    isExisting = true;
    // 注意: ここで entries を即削除しない。削除は「再挿入する行が確定」してから行う（下記）。
  } else {
    const { data, error } = await supabase.from("daily_reports_v2").insert(header).select("id").single();
    if (error || !data) {
      console.error("syncLegacyReportToV2 insert failed", error);
      return;
    }
    reportId = data.id;
  }

  // entries（旧固定カラム→縦持ち）
  const rows: { report_id: string; unit_id: string; field_key: string; value_num: number }[] = [];
  const push = (code: string, fieldKey: string, value: number) => {
    const unitId = unitByCode.get(code);
    if (unitId) rows.push({ report_id: reportId, unit_id: unitId, field_key: fieldKey, value_num: value });
  };
  if (r.carrier === "YAMATO") {
    push("TAKUHAIBIN", "completed", n(r.takuhaibin_completed));
    push("TAKUHAIBIN", "returned", n(r.takuhaibin_returned));
    push("NEKOPOS", "completed", n(r.nekopos_completed));
    push("NEKOPOS", "returned", n(r.nekopos_returned));
  } else if (r.carrier === "AMAZON") {
    push("AMAZON_DELIVERY", "am_mochidashi", n(r.amazon_am_mochidashi));
    push("AMAZON_DELIVERY", "am_completed", n(r.amazon_am_completed));
    push("AMAZON_DELIVERY", "pm_mochidashi", n(r.amazon_pm_mochidashi));
    push("AMAZON_DELIVERY", "pm_completed", n(r.amazon_pm_completed));
    push("AMAZON_DELIVERY", "four_mochidashi", n(r.amazon_4_mochidashi));
    push("AMAZON_DELIVERY", "four_completed", n(r.amazon_4_completed));
  }

  // ── データ消失防止（現運用は /submit が V2 で report_entries に直接書く。旧テーブルを
  //    正本に上書きすると V2 実データを潰しうるため、破壊的更新を抑止する）──
  // 1) 再挿入する行が無い（対象外carrier / unitコード不一致）ときは既存entriesを温存。
  if (rows.length === 0) return;
  // 2) 既存に明細があり、今回がすべて0なら上書きしない（実数を0で潰さない）。
  const hasMeaningful = rows.some((x) => x.value_num !== 0);
  if (isExisting && !hasMeaningful) {
    const { count } = await supabase
      .from("report_entries")
      .select("id", { count: "exact", head: true })
      .eq("report_id", reportId);
    if ((count ?? 0) > 0) return; // 既存の実データを保護
  }
  // 安全と判断できたときだけ置換する。
  await supabase.from("report_entries").delete().eq("report_id", reportId);
  await supabase.from("report_entries").insert(rows);
}

/** 旧 daily_reports の承認/却下状態を、対応する v2 にミラーする（driver+date 単位）。 */
export async function mirrorApprovalToV2(driverId: string, date: string): Promise<void> {
  const { data: olds } = await supabase
    .from("daily_reports")
    .select("id, approved_at, approved_by, rejected_at, rejected_by")
    .eq("driver_id", driverId)
    .eq("report_date", date);
  for (const o of olds ?? []) {
    await supabase
      .from("daily_reports_v2")
      .update({
        approved_at: (o as any).approved_at ?? null,
        approved_by: (o as any).approved_by ?? null,
        rejected_at: (o as any).rejected_at ?? null,
        rejected_by: (o as any).rejected_by ?? null,
      })
      .eq("legacy_report_id", (o as any).id);
  }
}
