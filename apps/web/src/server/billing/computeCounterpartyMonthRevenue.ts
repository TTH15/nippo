import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAggregationData } from "@/server/aggregation/load";
import { buildContext, buildContributions, isCountableReport } from "@/server/aggregation/compute";
import { getDisplayName } from "@/lib/displayName";

// ============================================================
// 取引先別・セクション別の「請求売上（システム計上）」を v2 集計モデルから算出する。
//   従量: course_unit_rates × billable な report_entries 数量
//   固定: course_fixed_rates × 稼働(承認済み report)日数
// 旧 course_rates / daily_reports / 宅急便・ネコポス・固定ハードコードへの依存を排除。
// 売上総額は admin/sales（同じ v2 エンジン）と一致する（parity: check-counterparty-billing）。
// ============================================================

export type Section = "Amazon" | "ヤマト運輸" | "郵便局";

/** carriers.code から請求セクション（既存3区分）を導出 */
export function sectionFromCarrierCode(code: string | null | undefined): Section {
  if (code === "AMAZON") return "Amazon";
  if (code === "YAMATO") return "ヤマト運輸";
  return "郵便局";
}

/** carriers.code を 3 区分の carrier バケットへ（旧 YAMATO/AMAZON/OTHER 互換） */
function carrierBucketFromCode(code: string | null | undefined): "YAMATO" | "AMAZON" | "OTHER" {
  if (code === "AMAZON") return "AMAZON";
  if (code === "YAMATO") return "YAMATO";
  return "OTHER";
}

export type SystemBillingLineKind = "course_fixed" | "course_unit";

/** システム集計行（コース別・請求書明細風） */
export type SystemBillingLine = {
  kind: SystemBillingLineKind;
  /** 明細キー: 従量 `u:<courseId>:<unitId>:drv:<driverId>` / 固定 `fx:<courseId>:drv:<driverId>` */
  lineKey: string;
  courseId: string;
  courseName: string;
  /** 従量行のみ unit を持つ（固定は未設定） */
  unitId?: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

/**
 * 取引先に紐づくコースごとの件数・売上行を v2 集計（course_unit_rates / course_fixed_rates）で算出する。
 */
export async function computeCounterpartyMonthBillingDetail(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string,
  counterpartyInvoiceAddressId: string,
): Promise<{ systemLines: SystemBillingLine[]; systemTotal: number }> {
  // 1. 対象コース（sort_order 順を保持）
  const { data: courseRows, error: coursesErr } = await supabase
    .from("courses")
    .select("id, name, sort_order")
    .eq("org_id", orgId)
    .eq("counterparty_invoice_address_id", counterpartyInvoiceAddressId)
    .order("sort_order", { ascending: true });
  if (coursesErr) throw coursesErr;
  if (!courseRows?.length) return { systemLines: [], systemTotal: 0 };

  const orderedCourseIds = courseRows.map((c) => String(c.id));
  const courseNameById = new Map<string, string>();
  courseRows.forEach((c) => courseNameById.set(String(c.id), String(c.name ?? "")));
  const allowed = new Set(orderedCourseIds);

  // 2. v2 正規化データ。取引先に紐づくコースの日報だけを読む
  // （org 全体の日報+entries を転送して JS で捨てるのは展開N+1の主因だった・2026-08 監査）。
  // ledger はこの明細では未使用のため読まない。
  const data = await loadAggregationData(supabase, orgId, startDate, endDate, {
    courseIds: orderedCourseIds,
    withLedger: false,
  });
  const unitById = new Map(data.units.map((u) => [u.id, u]));
  const rateByCourseUnit = new Map(data.unitRates.map((r) => [`${r.courseId}:${r.unitId}`, r]));
  const fixedByCourse = new Map(data.fixedRates.map((r) => [r.courseId, r]));

  // 3. 表示名・並び（unit 名/並び、ドライバー名）
  const [{ data: unitRows }, { data: driverRows }] = await Promise.all([
    supabase.from("units").select("id, name, sort_order"),
    // 明細の担当者名。自社ドライバーだけを引く（他社の氏名を読まない）
    supabase.from("drivers").select("id, name, display_name").eq("org_id", orgId),
  ]);
  const unitNameById = new Map<string, string>();
  const unitSortById = new Map<string, number>();
  (unitRows ?? []).forEach((u: { id: string; name: string | null; sort_order: number | null }) => {
    unitNameById.set(u.id, String(u.name ?? ""));
    unitSortById.set(u.id, Number(u.sort_order) || 0);
  });
  const driverNameById = new Map<string, string>();
  (driverRows ?? []).forEach((d: { id: string; name: string; display_name: string | null }) => {
    driverNameById.set(d.id, getDisplayName(d) || "担当者");
  });

  // 4. 集計
  // 従量: courseId -> unitId -> driverId -> 数量
  const puQty = new Map<string, Map<string, Map<string, number>>>();
  // 固定: courseId -> driverId -> 稼働日数
  const fixedDays = new Map<string, Map<string, number>>();

  const addPu = (courseId: string, unitId: string, driverId: string, qty: number) => {
    let byUnit = puQty.get(courseId);
    if (!byUnit) puQty.set(courseId, (byUnit = new Map()));
    let byDriver = byUnit.get(unitId);
    if (!byDriver) byUnit.set(unitId, (byDriver = new Map()));
    byDriver.set(driverId, (byDriver.get(driverId) ?? 0) + qty);
  };
  const addFixed = (courseId: string, driverId: string) => {
    let byDriver = fixedDays.get(courseId);
    if (!byDriver) fixedDays.set(courseId, (byDriver = new Map()));
    byDriver.set(driverId, (byDriver.get(driverId) ?? 0) + 1);
  };

  for (const r of data.reports) {
    if (!isCountableReport(r)) continue;
    const courseId = r.courseId;
    if (!courseId || !allowed.has(courseId)) continue;
    const driverId = r.driverId;

    // 従量
    for (const e of r.entries) {
      const unit = unitById.get(e.unitId);
      if (!unit) continue;
      const f = unit.fields.find((x) => x.fieldKey === e.fieldKey);
      if (!f || !f.isBillable) continue;
      if (!rateByCourseUnit.has(`${courseId}:${e.unitId}`)) continue;
      const qty = e.valueNum ?? 0;
      if (!qty) continue;
      addPu(courseId, e.unitId, driverId, qty);
    }

    // 固定（course_fixed_rates が非0なら 1 report = 1 稼働日）
    const fx = fixedByCourse.get(courseId);
    if (fx && (fx.fixedRevenue !== 0 || fx.fixedProfit !== 0 || fx.fixedPayout !== 0)) {
      addFixed(courseId, driverId);
    }
  }

  // 5. 明細生成
  const systemLines: SystemBillingLine[] = [];
  let systemTotal = 0;
  const byDriverNameAsc = (a: string, b: string) =>
    (driverNameById.get(a) ?? "").localeCompare(driverNameById.get(b) ?? "", "ja");

  for (const courseId of orderedCourseIds) {
    const courseName = courseNameById.get(courseId) ?? "";

    // 従量（unit を sort_order 順、driver を名前順）
    const unitMap = puQty.get(courseId);
    if (unitMap) {
      const unitIds = [...unitMap.keys()].sort(
        (a, b) => (unitSortById.get(a) ?? 0) - (unitSortById.get(b) ?? 0),
      );
      for (const unitId of unitIds) {
        const rate = rateByCourseUnit.get(`${courseId}:${unitId}`);
        if (!rate) continue;
        const drvMap = unitMap.get(unitId)!;
        const unitName = unitNameById.get(unitId) ?? "";
        for (const driverId of [...drvMap.keys()].sort(byDriverNameAsc)) {
          const qty = drvMap.get(driverId) ?? 0;
          const amount = qty * rate.revenuePerUnit;
          systemTotal += amount;
          systemLines.push({
            kind: "course_unit",
            lineKey: `u:${courseId}:${unitId}:drv:${driverId}`,
            courseId,
            courseName,
            unitId,
            label: `${courseName} ${unitName}（${driverNameById.get(driverId) ?? "担当者"}）`,
            quantity: qty,
            unitPrice: rate.revenuePerUnit,
            amount,
          });
        }
      }
    }

    // 固定（driver を名前順）
    const fx = fixedByCourse.get(courseId);
    const fdMap = fixedDays.get(courseId);
    if (fx && fdMap) {
      for (const driverId of [...fdMap.keys()].sort(byDriverNameAsc)) {
        const days = fdMap.get(driverId) ?? 0;
        if (!days) continue;
        const amount = days * fx.fixedRevenue;
        systemTotal += amount;
        systemLines.push({
          kind: "course_fixed",
          lineKey: `fx:${courseId}:drv:${driverId}`,
          courseId,
          courseName,
          label: `${courseName}（固定売上・稼働日・${driverNameById.get(driverId) ?? "担当者"}）`,
          quantity: days,
          unitPrice: fx.fixedRevenue,
          amount,
        });
      }
    }
  }

  return { systemLines, systemTotal };
}

/**
 * 指定期間・取引先（請求先）に紐づくコースのシフト売上合計（システム計上のみ）。
 */
export async function computeCounterpartyMonthRevenue(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string,
  counterpartyInvoiceAddressId: string,
): Promise<number> {
  const { systemTotal } = await computeCounterpartyMonthBillingDetail(
    supabase,
    orgId,
    startDate,
    endDate,
    counterpartyInvoiceAddressId,
  );
  return systemTotal;
}

/**
 * セクション（キャリア区分）単位の月次売上合計を v2 集計から算出する。
 * 郵便局は course に乗らない手動売上（sales_log_entries の COMPANY 計上）で従来どおり。
 */
export async function computeSectionMonthRevenue(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string,
  section: Section,
): Promise<number> {
  if (section === "郵便局") {
    const { data, error } = await supabase
      .from("sales_log_entries")
      .select("revenue, attribution")
      .eq("org_id", orgId)
      .gte("log_date", startDate)
      .lte("log_date", endDate)
      .eq("attribution", "COMPANY");
    if (error) throw error;
    let total = 0;
    (data ?? []).forEach((row: { revenue: number | null }) => {
      const v = Number(row.revenue) || 0;
      if (v > 0) total += v;
    });
    return total;
  }

  const data = await loadAggregationData(supabase, orgId, startDate, endDate);
  const ctx = buildContext(data.units, data.unitRates, data.fixedRates);
  const contribs = buildContributions(data.reports, [], ctx); // ledger 無し = auto のみ

  const carrierCodeByCourse = await loadCarrierCodeByCourse(supabase, orgId);
  const targetIsAmazon = section === "Amazon";

  let total = 0;
  for (const c of contribs) {
    const code = carrierCodeByCourse.get(c.courseId ?? "") ?? null;
    const isAmazon = code === "AMAZON";
    // 旧ロジック踏襲: ヤマト運輸セクションは「Amazon 以外（OTHER 含む）」を集計
    const match = targetIsAmazon ? isAmazon : !isAmazon;
    if (match) total += c.revenue;
  }
  return total;
}

/**
 * courseId -> carriers.code（carrier_id 由来）。旧 courses.carrier text / 名前推論を置換。
 * courses はテナント固有マスタのため orgId 必須（carriers は全社共通マスタ）。
 */
export async function loadCarrierCodeByCourse(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Map<string, string | null>> {
  const [{ data: courseRows }, { data: carrierRows }] = await Promise.all([
    supabase.from("courses").select("id, carrier_id").eq("org_id", orgId),
    supabase.from("carriers").select("id, code"),
  ]);
  const codeByCarrierId = new Map<string, string | null>();
  (carrierRows ?? []).forEach((c: { id: string; code: string | null }) =>
    codeByCarrierId.set(c.id, c.code ?? null),
  );
  const out = new Map<string, string | null>();
  (courseRows ?? []).forEach((c: { id: string; carrier_id: string | null }) => {
    out.set(String(c.id), c.carrier_id ? codeByCarrierId.get(c.carrier_id) ?? null : null);
  });
  return out;
}

export type CounterpartyCourse = { id: string; name: string; carrier: "YAMATO" | "AMAZON" | "OTHER" };

export function dominantSectionFromCourses(courses: CounterpartyCourse[]): Section {
  let a = 0;
  let y = 0;
  let o = 0;
  for (const c of courses) {
    if (c.carrier === "AMAZON") a++;
    else if (c.carrier === "YAMATO") y++;
    else o++;
  }
  if (a >= y && a >= o) return "Amazon";
  if (y >= o) return "ヤマト運輸";
  return "郵便局";
}

/** carriers.code を CounterpartyCourse.carrier バケットへ（呼び出し側ヘルパ） */
export function courseCarrierBucket(code: string | null | undefined): "YAMATO" | "AMAZON" | "OTHER" {
  return carrierBucketFromCode(code);
}
