import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission, isAuthError } from "@/server/auth";
import { COURSE_BILLING_VIEW_CAPS, COURSE_BILLING_MANAGE_CAPS } from "@/server/auth/domainCaps";
import { supabase } from "@/server/db/client";
import { resolveOrgId } from "@/server/db/tenant";
import { exclusiveUnitPriceOf, roundUnitPrice } from "@repo/core/logic/taxBasis";

export const dynamic = "force-dynamic";
const taxBasis = (value: unknown, fallback: "exclusive" | "inclusive" = "exclusive"): "exclusive" | "inclusive" =>
  value === "inclusive" ? "inclusive" : value === "exclusive" ? "exclusive" : fallback;

// ============================================================
// コース課金（新モデル）の取得/保存
//   従量: course_unit_rates（course×unit）
//   固定(日当): course_fixed_rates（course）
// 移行期のため、旧 course_rates も同期（dual-write）して既存画面と整合させる。
// ============================================================

// GET: ?course_id=... → そのコースのキャリア配下 unit と現単価
//      ?carrier_id=... → コース未作成（新規作成）向け。キャリア配下 unit のみ（単価は空）。
export async function GET(req: NextRequest) {
  // 単価表はロール定義上「コース／単価表の編集（can_manage_courses）」の領域。
  // 請求系（can_view_billing）だけを要求すると、コース編集権限のみのロールが
  // 単価フォームを開けず 403 になる（2026-08-14 実地報告）。どちらかで可。
  const user = await requireAnyPermission(req, COURSE_BILLING_VIEW_CAPS);
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const courseId = req.nextUrl.searchParams.get("course_id") ?? "";
  const carrierIdParam = req.nextUrl.searchParams.get("carrier_id") ?? "";
  if (!courseId && !carrierIdParam) {
    return NextResponse.json({ error: "course_id または carrier_id が必要です" }, { status: 400 });
  }

  // 既存コース: コースからキャリアを引く。新規作成: パラメータのキャリアをそのまま使う。
  let carrierId: string | null = carrierIdParam || null;
  let courseName = "";
  let revenueTaxBasis: "exclusive" | "inclusive" = "exclusive";
  let payoutTaxBasis: "exclusive" | "inclusive" = "exclusive";
  let revenuePieceTaxBasis: "exclusive" | "inclusive" = "exclusive";
  let payoutPieceTaxBasis: "exclusive" | "inclusive" = "exclusive";
  let revenueFixedTaxBasis: "exclusive" | "inclusive" = "exclusive";
  let payoutFixedTaxBasis: "exclusive" | "inclusive" = "exclusive";
  let revenueRateMode = "PER_PIECE";
  let payoutRateMode = "PER_PIECE";
  if (courseId) {
    const { data: course } = await supabase
      .from("courses")
      .select("id, name, carrier_id, revenue_tax_basis, payout_tax_basis, revenue_piece_tax_basis, payout_piece_tax_basis, revenue_fixed_tax_basis, payout_fixed_tax_basis, revenue_rate_mode, payout_rate_mode")
      .eq("id", courseId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!course) return NextResponse.json({ error: "コースが見つかりません" }, { status: 404 });
    carrierId = (course as any).carrier_id as string | null;
    courseName = (course as any).name ?? "";
    revenueTaxBasis = taxBasis((course as any).revenue_tax_basis);
    payoutTaxBasis = taxBasis((course as any).payout_tax_basis);
    revenuePieceTaxBasis = taxBasis((course as any).revenue_piece_tax_basis, revenueTaxBasis);
    payoutPieceTaxBasis = taxBasis((course as any).payout_piece_tax_basis, payoutTaxBasis);
    revenueFixedTaxBasis = taxBasis((course as any).revenue_fixed_tax_basis, revenueTaxBasis);
    payoutFixedTaxBasis = taxBasis((course as any).payout_fixed_tax_basis, payoutTaxBasis);
    revenueRateMode = (course as any).revenue_rate_mode ?? "PER_PIECE";
    payoutRateMode = (course as any).payout_rate_mode ?? "PER_PIECE";
  }

  const [{ data: units }, { data: unitRates }, { data: versions }, { data: fixed }, { data: fixedBundle }] = await Promise.all([
    carrierId
      ? supabase
          .from("units")
          .select("id, name, code, billing_type, sort_order, active")
          .eq("carrier_id", carrierId)
          .order("sort_order")
      : Promise.resolve({ data: [] as any[] }),
    // 新規作成（course_id 無し）では既存単価は無いので空。
    courseId
      ? supabase
          .from("course_unit_rates")
          .select("cycle_no, unit_id, revenue_per_unit, profit_per_unit, payout_per_unit, revenue_contract_amount, payout_contract_amount, revenue_quantity_rule, payout_quantity_rule")
          .eq("course_id", courseId)
      : Promise.resolve({ data: [] as any[] }),
    courseId
      ? supabase
          .from("course_rate_versions")
          .select("id, effective_from, created_at")
          .eq("org_id", orgId)
          .eq("course_id", courseId)
          .order("effective_from", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    courseId
      ? supabase
          .from("course_fixed_rates")
          .select("cycle_no, fixed_revenue, fixed_profit, fixed_payout, revenue_contract_amount, payout_contract_amount")
          .eq("course_id", courseId)
      : Promise.resolve({ data: [] as any[] }),
    courseId
      ? supabase
          .from("course_fixed_rate_bundles")
          .select("required_cycle_nos, fixed_revenue, fixed_payout, revenue_contract_amount, payout_contract_amount")
          .eq("course_id", courseId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return NextResponse.json({
    courseId: courseId || null,
    courseName,
    carrierId,
    revenueTaxBasis,
    payoutTaxBasis,
    revenuePieceTaxBasis,
    payoutPieceTaxBasis,
    revenueFixedTaxBasis,
    payoutFixedTaxBasis,
    revenueRateMode,
    payoutRateMode,
    units: units ?? [],
    unitRates: unitRates ?? [],
    fixedRates: fixed ?? [],
    fixedBundle: fixedBundle ?? null,
    fixed: (fixed ?? []).find((r: any) => Number(r.cycle_no) === 0) ?? { fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 },
    rateVersions: versions ?? [],
  });
}

type UnitRateInput = {
  cycle_no?: number;
  unit_id: string;
  revenue_per_unit?: number;
  profit_per_unit?: number;
  payout_per_unit?: number;
  revenue_contract_amount?: number;
  payout_contract_amount?: number;
  revenue_quantity_rule?: unknown;
  payout_quantity_rule?: unknown;
};

// 契約単価は小数を許す（例: 157.5円/個）。0.01円単位へ丸めて保存する。
const num = (v: unknown) => roundUnitPrice(Number(v) || 0);

// PUT: 単価保存（新テーブル upsert ＋ 旧 course_rates 同期）
export async function PUT(req: NextRequest) {
  // コース作成/編集フローは can_manage_courses で保存できる必要がある
  // （ロールUIの「コース・単価表・便の追加や変更ができます」に一致させる）。
  // ここが can_manage_billing のみだと、コース作成 POST 成功後の単価保存で 403 になり
  // 「コースの追加に失敗しました」と見える（2026-08-14 実地報告の原因）。
  const user = await requireAnyPermission(req, COURSE_BILLING_MANAGE_CAPS);
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const body = await req.json().catch(() => ({}));
  const courseId = typeof body.course_id === "string" ? body.course_id : "";
  if (!courseId) return NextResponse.json({ error: "course_id が必要です" }, { status: 400 });
  const { data: ownCourse } = await supabase
    .from("courses")
    .select("id, created_at")
    .eq("id", courseId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!ownCourse) return NextResponse.json({ error: "コースが見つかりません" }, { status: 404 });

  const unitRates: UnitRateInput[] = Array.isArray(body.unitRates) ? body.unitRates : [];
  const fixed = body.fixed ?? {};
  const revenueTaxBasis = taxBasis(body.revenueTaxBasis);
  const payoutTaxBasis = taxBasis(body.payoutTaxBasis);
  const revenuePieceTaxBasis = taxBasis(body.revenuePieceTaxBasis, revenueTaxBasis);
  const payoutPieceTaxBasis = taxBasis(body.payoutPieceTaxBasis, payoutTaxBasis);
  const revenueFixedTaxBasis = taxBasis(body.revenueFixedTaxBasis, revenueTaxBasis);
  const payoutFixedTaxBasis = taxBasis(body.payoutFixedTaxBasis, payoutTaxBasis);
  const validModes = new Set(["NONE", "PER_PIECE", "FIXED", "BOTH"]);
  const revenueRateMode = validModes.has(body.revenueRateMode) ? body.revenueRateMode : "PER_PIECE";
  const payoutRateMode = validModes.has(body.payoutRateMode) ? body.payoutRateMode : "PER_PIECE";
  const fixedRates = Array.isArray(body.fixedRates)
    ? body.fixedRates
    : [{ cycle_no: 0, ...fixed }];
  const fixedBundle = body.fixedBundle && typeof body.fixedBundle === "object" ? body.fixedBundle : null;
  const today = new Date().toISOString().slice(0, 10);
  const { data: existingVersion } = await supabase
    .from("course_rate_versions")
    .select("id")
    .eq("org_id", orgId)
    .eq("course_id", courseId)
    .limit(1)
    .maybeSingle();
  // 初回だけコース作成日、2回目以降は実際に単価を保存した日を適用日とする。
  // 同日の再保存は UNIQUE(course_id, effective_from) により同じ履歴を更新する。
  const courseCreatedDate = String((ownCourse as any).created_at ?? "").slice(0, 10);
  const effectiveFrom = existingVersion ? today : courseCreatedDate || today;

  // コースに「契約上の真の基準」を記録する（保存値自体は従来どおり常に税抜）。
  {
    const { error } = await supabase
      .from("courses")
      .update({
        revenue_tax_basis: revenueTaxBasis,
        payout_tax_basis: payoutTaxBasis,
        revenue_piece_tax_basis: revenuePieceTaxBasis,
        payout_piece_tax_basis: payoutPieceTaxBasis,
        revenue_fixed_tax_basis: revenueFixedTaxBasis,
        payout_fixed_tax_basis: payoutFixedTaxBasis,
        revenue_rate_mode: revenueRateMode,
        payout_rate_mode: payoutRateMode,
      })
      .eq("id", courseId);
    if (error) {
      console.error(error);
      return NextResponse.json({ error: "税区分の保存に失敗しました" }, { status: 500 });
    }
  }

  // --- 新: course_unit_rates ---
  if (unitRates.length > 0) {
    const rows = unitRates.map((r) => {
      const usesRevenue = revenueRateMode === "PER_PIECE" || revenueRateMode === "BOTH";
      const usesPayout = payoutRateMode === "PER_PIECE" || payoutRateMode === "BOTH";
      const revenue = usesRevenue ? num(r.revenue_per_unit) : 0;
      const payout = usesPayout ? num(r.payout_per_unit) : 0;
      return {
        course_id: courseId,
        cycle_no: Number.isInteger(r.cycle_no) && Number(r.cycle_no) >= 0 ? Number(r.cycle_no) : 0,
        unit_id: r.unit_id,
        revenue_per_unit: revenue,
        // 利益はクライアント値を信用せず売上−支払で導出する
        // （支払なしのコースで「売上−旧支払」が残ると利益が過少になるため）。
        profit_per_unit: roundUnitPrice(revenue - payout),
        payout_per_unit: payout,
        revenue_contract_amount: usesRevenue ? num(r.revenue_contract_amount) : 0,
        payout_contract_amount: usesPayout ? num(r.payout_contract_amount) : 0,
        revenue_quantity_rule: r.revenue_quantity_rule ?? { kind: "actual" },
        payout_quantity_rule: r.payout_quantity_rule ?? { kind: "actual" },
        updated_at: new Date().toISOString(),
      };
    });
    // cycle_no は便ごとの単価（migration 136）。0 = 全便共通で、便を使わないコースは常にこれ
    const { error } = await supabase
      .from("course_unit_rates")
      .upsert(rows, { onConflict: "course_id,cycle_no,unit_id" });
    if (error) {
      console.error(error);
      return NextResponse.json({ error: "従量単価の保存に失敗しました" }, { status: 500 });
    }
  }

  // --- 新: course_fixed_rates ---
  {
    const fixedRows = fixedRates.map((r: any) => {
      const revenue = revenueRateMode === "FIXED" || revenueRateMode === "BOTH" ? num(r.fixed_revenue) : 0;
      const payout = payoutRateMode === "FIXED" || payoutRateMode === "BOTH" ? num(r.fixed_payout) : 0;
      return {
        course_id: courseId,
        cycle_no: Number.isInteger(r.cycle_no) && Number(r.cycle_no) >= 0 ? Number(r.cycle_no) : 0,
        fixed_revenue: revenue,
        fixed_profit: roundUnitPrice(revenue - payout),
        fixed_payout: payout,
        revenue_contract_amount: revenueRateMode === "FIXED" || revenueRateMode === "BOTH" ? num(r.revenue_contract_amount) : 0,
        payout_contract_amount: payoutRateMode === "FIXED" || payoutRateMode === "BOTH" ? num(r.payout_contract_amount) : 0,
        updated_at: new Date().toISOString(),
      };
    });
    const { error } = await supabase
      .from("course_fixed_rates")
      .upsert(fixedRows, { onConflict: "course_id,cycle_no" });
    if (error) {
      console.error(error);
      return NextResponse.json({ error: "固定単価の保存に失敗しました" }, { status: 500 });
    }
  }

  // 現在値の保存に成功した後で、適用開始日付き履歴も固定する。
  if (fixedBundle) {
    const revenueContract = fixedBundle.revenue_contract_amount == null ? null : num(fixedBundle.revenue_contract_amount);
    const payoutContract = fixedBundle.payout_contract_amount == null ? null : num(fixedBundle.payout_contract_amount);
    const { error } = await supabase.from("course_fixed_rate_bundles").upsert({
      course_id: courseId,
      required_cycle_nos: Array.isArray(fixedBundle.required_cycle_nos)
        ? fixedBundle.required_cycle_nos.filter((value: unknown) => Number.isInteger(value) && Number(value) > 0)
        : [],
      fixed_revenue: revenueContract == null ? null : exclusiveUnitPriceOf(revenueContract, revenueFixedTaxBasis),
      fixed_payout: payoutContract == null ? null : exclusiveUnitPriceOf(payoutContract, payoutFixedTaxBasis),
      revenue_contract_amount: revenueContract,
      payout_contract_amount: payoutContract,
      updated_at: new Date().toISOString(),
    }, { onConflict: "course_id" });
    if (error) return NextResponse.json({ error: "全日日当の保存に失敗しました" }, { status: 500 });
  }

  // 現在値の保存に成功した後で、適用開始日付き履歴も固定する。
  {
    const { error } = await supabase.from("course_rate_versions").upsert(
      {
        org_id: orgId,
        course_id: courseId,
        effective_from: effectiveFrom,
        rate_data: {
          revenueTaxBasis, payoutTaxBasis,
          revenuePieceTaxBasis, payoutPieceTaxBasis, revenueFixedTaxBasis, payoutFixedTaxBasis,
          revenueRateMode, payoutRateMode, unitRates, fixedRates, fixedBundle,
        },
        created_by: user.driverId,
      },
      { onConflict: "course_id,effective_from" },
    );
    if (error) {
      console.error(error);
      return NextResponse.json({ error: "単価履歴の保存に失敗しました" }, { status: 500 });
    }
  }

  // Phase9-C: 旧 course_rates への dual-write は廃止（course_rates は計算で未参照＝凍結）。
  // 単価の source of truth は course_unit_rates + course_fixed_rates。

  return NextResponse.json({ ok: true });
}
