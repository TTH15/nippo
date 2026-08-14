import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission, isAuthError } from "@/server/auth";
import { COURSE_BILLING_VIEW_CAPS, COURSE_BILLING_MANAGE_CAPS } from "@/server/auth/domainCaps";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

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
  if (courseId) {
    const { data: course } = await supabase
      .from("courses")
      .select("id, name, carrier_id, revenue_tax_basis, payout_tax_basis")
      .eq("id", courseId)
      .maybeSingle();
    if (!course) return NextResponse.json({ error: "コースが見つかりません" }, { status: 404 });
    carrierId = (course as any).carrier_id as string | null;
    courseName = (course as any).name ?? "";
    revenueTaxBasis = (course as any).revenue_tax_basis === "inclusive" ? "inclusive" : "exclusive";
    payoutTaxBasis = (course as any).payout_tax_basis === "inclusive" ? "inclusive" : "exclusive";
  }

  const [{ data: units }, { data: unitRates }, { data: fixed }] = await Promise.all([
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
          .select("unit_id, revenue_per_unit, profit_per_unit, payout_per_unit")
          .eq("course_id", courseId)
      : Promise.resolve({ data: [] as any[] }),
    courseId
      ? supabase
          .from("course_fixed_rates")
          .select("fixed_revenue, fixed_profit, fixed_payout")
          .eq("course_id", courseId)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
  ]);

  return NextResponse.json({
    courseId: courseId || null,
    courseName,
    carrierId,
    revenueTaxBasis,
    payoutTaxBasis,
    units: units ?? [],
    unitRates: unitRates ?? [],
    fixed: fixed ?? { fixed_revenue: 0, fixed_profit: 0, fixed_payout: 0 },
  });
}

type UnitRateInput = {
  unit_id: string;
  revenue_per_unit?: number;
  profit_per_unit?: number;
  payout_per_unit?: number;
};

const num = (v: unknown) => Math.trunc(Number(v) || 0);

// PUT: 単価保存（新テーブル upsert ＋ 旧 course_rates 同期）
export async function PUT(req: NextRequest) {
  // コース作成/編集フローは can_manage_courses で保存できる必要がある
  // （ロールUIの「コース・単価表・便の追加や変更ができます」に一致させる）。
  // ここが can_manage_billing のみだと、コース作成 POST 成功後の単価保存で 403 になり
  // 「コースの追加に失敗しました」と見える（2026-08-14 実地報告の原因）。
  const user = await requireAnyPermission(req, COURSE_BILLING_MANAGE_CAPS);
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const courseId = typeof body.course_id === "string" ? body.course_id : "";
  if (!courseId) return NextResponse.json({ error: "course_id が必要です" }, { status: 400 });

  const unitRates: UnitRateInput[] = Array.isArray(body.unitRates) ? body.unitRates : [];
  const fixed = body.fixed ?? {};
  const fixedRevenue = num(fixed.fixed_revenue);
  const fixedProfit = num(fixed.fixed_profit);
  const fixedPayout = num(fixed.fixed_payout);
  const revenueTaxBasis = body.revenueTaxBasis === "inclusive" ? "inclusive" : "exclusive";
  const payoutTaxBasis = body.payoutTaxBasis === "inclusive" ? "inclusive" : "exclusive";

  // コースに「契約上の真の基準」を記録する（保存値自体は従来どおり常に税抜）。
  {
    const { error } = await supabase
      .from("courses")
      .update({ revenue_tax_basis: revenueTaxBasis, payout_tax_basis: payoutTaxBasis })
      .eq("id", courseId);
    if (error) {
      console.error(error);
      return NextResponse.json({ error: "税区分の保存に失敗しました" }, { status: 500 });
    }
  }

  // --- 新: course_unit_rates ---
  if (unitRates.length > 0) {
    const rows = unitRates.map((r) => ({
      course_id: courseId,
      unit_id: r.unit_id,
      revenue_per_unit: num(r.revenue_per_unit),
      profit_per_unit: num(r.profit_per_unit),
      payout_per_unit: num(r.payout_per_unit),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("course_unit_rates")
      .upsert(rows, { onConflict: "course_id,unit_id" });
    if (error) {
      console.error(error);
      return NextResponse.json({ error: "従量単価の保存に失敗しました" }, { status: 500 });
    }
  }

  // --- 新: course_fixed_rates ---
  {
    const { error } = await supabase
      .from("course_fixed_rates")
      .upsert(
        {
          course_id: courseId,
          fixed_revenue: fixedRevenue,
          fixed_profit: fixedProfit,
          fixed_payout: fixedPayout,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "course_id" },
      );
    if (error) {
      console.error(error);
      return NextResponse.json({ error: "固定単価の保存に失敗しました" }, { status: 500 });
    }
  }

  // Phase9-C: 旧 course_rates への dual-write は廃止（course_rates は計算で未参照＝凍結）。
  // 単価の source of truth は course_unit_rates + course_fixed_rates。

  return NextResponse.json({ ok: true });
}
