import type { SupabaseClient } from "@supabase/supabase-js";
import { applyQuantityRule } from "@/server/billing/quantityRule";
import { loadAggregationData } from "@/server/aggregation/load";
import { buildContext, buildContributions, dropSupersededLegacyReports, isCountableReport } from "@/server/aggregation/compute";
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

const taxBasis = (value: unknown, fallback: "exclusive" | "inclusive" = "exclusive"): "exclusive" | "inclusive" =>
  value === "inclusive" ? "inclusive" : value === "exclusive" ? "exclusive" : fallback;

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
  priceBasis: "exclusive" | "inclusive";
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
    .select("id, name, sort_order, revenue_tax_basis, revenue_piece_tax_basis, revenue_fixed_tax_basis")
    .eq("org_id", orgId)
    .eq("counterparty_invoice_address_id", counterpartyInvoiceAddressId)
    .order("sort_order", { ascending: true });
  if (coursesErr) throw coursesErr;
  if (!courseRows?.length) return { systemLines: [], systemTotal: 0 };

  const orderedCourseIds = courseRows.map((c) => String(c.id));
  const courseNameById = new Map<string, string>();
  const revenuePieceBasisByCourse = new Map<string, "exclusive" | "inclusive">();
  const revenueFixedBasisByCourse = new Map<string, "exclusive" | "inclusive">();
  courseRows.forEach((c) => {
    courseNameById.set(String(c.id), String(c.name ?? ""));
    const legacyBasis = taxBasis(c.revenue_tax_basis);
    revenuePieceBasisByCourse.set(String(c.id), taxBasis(c.revenue_piece_tax_basis, legacyBasis));
    revenueFixedBasisByCourse.set(String(c.id), taxBasis(c.revenue_fixed_tax_basis, legacyBasis));
  });
  const allowed = new Set(orderedCourseIds);

  // 2. v2 正規化データ。取引先に紐づくコースの日報だけを読む
  // （org 全体の日報+entries を転送して JS で捨てるのは展開N+1の主因だった・2026-08 監査）。
  // ledger はこの明細では未使用のため読まない。
  const data = await loadAggregationData(supabase, orgId, startDate, endDate, {
    courseIds: orderedCourseIds,
    withLedger: false,
  });
  const unitById = new Map(data.units.map((u) => [u.id, u]));
  const rateByCourseUnit = new Map(data.unitRates.map((r) => [`${r.courseId}:${r.cycleNo ?? 0}:${r.unitId}`, r]));
  const fixedByCourse = new Map(data.fixedRates.map((r) => [`${r.courseId}:${r.cycleNo ?? 0}`, r]));
  // 売上の計算方式(NONE/PER_PIECE/FIXED/BOTH)が正本。方式外の単価行は請求明細にも載せない。
  const revenueModeByCourse = new Map(data.courseBillingMeta.map((m) => [m.courseId, m.revenueRateMode]));
  const revenueUsesPiece = (courseId: string) => {
    const mode = revenueModeByCourse.get(courseId) ?? "BOTH";
    return mode === "PER_PIECE" || mode === "BOTH";
  };
  const revenueUsesFixed = (courseId: string) => {
    const mode = revenueModeByCourse.get(courseId) ?? "BOTH";
    return mode === "FIXED" || mode === "BOTH";
  };
  const effectiveReports = dropSupersededLegacyReports(data.reports);
  const bundleByCourse = new Map(data.fixedRateBundles.map((b) => [b.courseId, b]));
  const aggregationContext = buildContext(data.units, data.unitRates, data.fixedRates, data.fixedRateBundles, data.courseBillingMeta);
  // 内部集計は承認時スナップショットを正本にする。これにより単価変更後も過去月が動かず、
  // admin/sales と同じ v2 集計結果になる。請求明細側は契約単価・契約税基準を別途保持する。
  const systemTotal = buildContributions(data.reports, [], aggregationContext)
    .filter((item) => item.courseId != null && allowed.has(item.courseId))
    .reduce((sum, item) => sum + item.revenue, 0);

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
  // 従量: courseId -> `${cycleNo}:${unitId}` -> driverId -> 計算数量
  const puQty = new Map<string, Map<string, Map<string, number>>>();
  // 固定: courseId -> driverId -> 稼働日数
  const fixedDays = new Map<string, Map<string, number>>();

  const addPu = (courseId: string, cycleUnitKey: string, driverId: string, qty: number) => {
    let byUnit = puQty.get(courseId);
    if (!byUnit) puQty.set(courseId, (byUnit = new Map()));
    let byDriver = byUnit.get(cycleUnitKey);
    if (!byDriver) byUnit.set(cycleUnitKey, (byDriver = new Map()));
    byDriver.set(driverId, (byDriver.get(driverId) ?? 0) + qty);
  };
  const addFixed = (rateKey: string, driverId: string) => {
    let byDriver = fixedDays.get(rateKey);
    if (!byDriver) fixedDays.set(rateKey, (byDriver = new Map()));
    byDriver.set(driverId, (byDriver.get(driverId) ?? 0) + 1);
  };

  for (const r of effectiveReports) {
    if (!isCountableReport(r)) continue;
    const courseId = r.courseId;
    if (!courseId || !allowed.has(courseId)) continue;
    const driverId = r.driverId;

    // 従量
    for (const e of r.entries) {
      if (!revenueUsesPiece(courseId)) break;
      const unit = unitById.get(e.unitId);
      if (!unit) continue;
      const f = unit.fields.find((x) => x.fieldKey === e.fieldKey);
      if (!f || !f.isBillable) continue;
      const rateKey = rateByCourseUnit.has(`${courseId}:${r.cycleNo ?? 0}:${e.unitId}`)
        ? `${courseId}:${r.cycleNo ?? 0}:${e.unitId}`
        : `${courseId}:0:${e.unitId}`;
      const rate = rateByCourseUnit.get(rateKey);
      if (!rate) continue;
      const qty = e.valueNum ?? 0;
      if (!qty) continue;
      addPu(courseId, `${rate.cycleNo ?? 0}:${e.unitId}`, driverId, applyQuantityRule(qty, rate.revenueQuantityRule));
    }

    // 固定（course_fixed_rates が非0なら 1 report = 1 稼働日）
    const fixedKey = fixedByCourse.has(`${courseId}:${r.cycleNo ?? 0}`)
      ? `${courseId}:${r.cycleNo ?? 0}`
      : `${courseId}:0`;
    const fx = fixedByCourse.get(fixedKey);
    if (fx && revenueUsesFixed(courseId) && fx.fixedRevenue !== 0) {
      addFixed(fixedKey, driverId);
    } else if (revenueUsesFixed(courseId) && (r.cycleNo ?? 0) === 0) {
      // サイクル導入前の cycle_no=0 日報は「その日フル稼働」の意味で、
      // 便別の日当行では拾えない。全日日当（bundle）を1日分として計上する。
      // これを落とすと請求明細から丸ごと消える（2026-08-28 実地確認）。
      const bundle = bundleByCourse.get(courseId);
      if (bundle && (bundle.revenueContractAmount != null || bundle.fixedRevenue != null)) {
        addFixed(`${courseId}:bundle`, driverId);
      }
    }
  }

  // 5. 明細生成
  const systemLines: SystemBillingLine[] = [];
  const byDriverNameAsc = (a: string, b: string) =>
    (driverNameById.get(a) ?? "").localeCompare(driverNameById.get(b) ?? "", "ja");

  for (const courseId of orderedCourseIds) {
    const courseName = courseNameById.get(courseId) ?? "";

    // 従量（unit を sort_order 順、driver を名前順）
    const unitMap = puQty.get(courseId);
    if (unitMap) {
      const cycleUnitKeys = [...unitMap.keys()].sort(
        (a, b) => {
          const [aCycle, aUnit] = a.split(":");
          const [bCycle, bUnit] = b.split(":");
          return Number(aCycle) - Number(bCycle) || (unitSortById.get(aUnit) ?? 0) - (unitSortById.get(bUnit) ?? 0);
        },
      );
      for (const cycleUnitKey of cycleUnitKeys) {
        const [cycleNo, unitId] = cycleUnitKey.split(":");
        const rate = rateByCourseUnit.get(`${courseId}:${cycleNo}:${unitId}`);
        if (!rate) continue;
        const drvMap = unitMap.get(cycleUnitKey)!;
        const unitName = unitNameById.get(unitId) ?? "";
        for (const driverId of [...drvMap.keys()].sort(byDriverNameAsc)) {
          const qty = drvMap.get(driverId) ?? 0;
          // 契約原額が未保存の行は保存値（常に税抜）をそのまま単価にする。
          // コースの税基準(inclusive)を当てると税抜値を税込として請求し、約10%の過少請求になる。
          const hasContract = rate.revenueContractAmount != null;
          const priceBasis = hasContract ? revenuePieceBasisByCourse.get(courseId) ?? "exclusive" : "exclusive";
          const contractUnitPrice = hasContract ? rate.revenueContractAmount! : rate.revenuePerUnit;
          systemLines.push({
            kind: "course_unit",
            lineKey: `u:${courseId}:cycle:${cycleNo}:${unitId}:drv:${driverId}`,
            courseId,
            courseName,
            unitId,
            label: `${courseName} ${unitName}${cycleNo !== "0" ? `・${cycleNo}便` : ""}（${driverNameById.get(driverId) ?? "担当者"}）`,
            quantity: qty,
            unitPrice: contractUnitPrice,
            // 単価は小数を許すが、明細金額は円単位へ丸める
            amount: Math.round(qty * contractUnitPrice),
            priceBasis,
          });
        }
      }
    }

    // 固定（driver を名前順）
    for (const [fixedKey, fdMap] of fixedDays) {
      const [fixedCourseId, cycleNo] = fixedKey.split(":");
      if (fixedCourseId !== courseId) continue;
      // cycle_no=0 の旧日報は全日日当（bundle）を1日分として計上する
      const bundle = cycleNo === "bundle" ? bundleByCourse.get(courseId) : null;
      const fx = bundle ? null : fixedByCourse.get(fixedKey);
      if (!fx && !bundle) continue;
      const hasContract = bundle
        ? bundle.revenueContractAmount != null
        : fx!.revenueContractAmount != null;
      const priceBasis = hasContract ? revenueFixedBasisByCourse.get(courseId) ?? "exclusive" : "exclusive";
      const contractUnitPrice = bundle
        ? (bundle.revenueContractAmount ?? bundle.fixedRevenue ?? 0)
        : (hasContract ? fx!.revenueContractAmount! : fx!.fixedRevenue);
      if (!contractUnitPrice) continue;
      for (const driverId of [...fdMap.keys()].sort(byDriverNameAsc)) {
        const days = fdMap.get(driverId) ?? 0;
        if (!days) continue;
        const suffix = bundle ? "・全日" : cycleNo !== "0" ? `・${cycleNo}便` : "";
        systemLines.push({
          kind: "course_fixed",
          lineKey: `fx:${courseId}:cycle:${cycleNo}:drv:${driverId}`,
          courseId,
          courseName,
          label: `${courseName}（固定売上${suffix}・稼働日・${driverNameById.get(driverId) ?? "担当者"}）`,
          quantity: days,
          unitPrice: contractUnitPrice,
          amount: Math.round(days * contractUnitPrice),
          priceBasis,
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
  const ctx = buildContext(data.units, data.unitRates, data.fixedRates, data.fixedRateBundles, data.courseBillingMeta);
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
