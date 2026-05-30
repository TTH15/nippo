import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// コース課金（新モデル）の取得/保存
//   従量: course_unit_rates（course×unit）
//   固定(日当): course_fixed_rates（course）
// 移行期のため、旧 course_rates も同期（dual-write）して既存画面と整合させる。
// ============================================================

// GET: ?course_id=... → そのコースのキャリア配下 unit と現単価
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const courseId = req.nextUrl.searchParams.get("course_id") ?? "";
  if (!courseId) return NextResponse.json({ error: "course_id が必要です" }, { status: 400 });

  const { data: course } = await supabase
    .from("courses")
    .select("id, name, carrier_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return NextResponse.json({ error: "コースが見つかりません" }, { status: 404 });

  const carrierId = (course as any).carrier_id as string | null;

  const [{ data: units }, { data: unitRates }, { data: fixed }] = await Promise.all([
    carrierId
      ? supabase
          .from("units")
          .select("id, name, code, billing_type, sort_order, active")
          .eq("carrier_id", carrierId)
          .order("sort_order")
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from("course_unit_rates")
      .select("unit_id, revenue_per_unit, profit_per_unit, payout_per_unit")
      .eq("course_id", courseId),
    supabase
      .from("course_fixed_rates")
      .select("fixed_revenue, fixed_profit, fixed_payout")
      .eq("course_id", courseId)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    courseId,
    courseName: (course as any).name ?? "",
    carrierId,
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
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const courseId = typeof body.course_id === "string" ? body.course_id : "";
  if (!courseId) return NextResponse.json({ error: "course_id が必要です" }, { status: 400 });

  const unitRates: UnitRateInput[] = Array.isArray(body.unitRates) ? body.unitRates : [];
  const fixed = body.fixed ?? {};
  const fixedRevenue = num(fixed.fixed_revenue);
  const fixedProfit = num(fixed.fixed_profit);
  const fixedPayout = num(fixed.fixed_payout);

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

  // --- 旧 course_rates 同期（dual-write）。unit を code で対応付け ---
  const { data: units } = await supabase
    .from("units")
    .select("id, code")
    .in("id", unitRates.map((r) => r.unit_id).filter(Boolean));
  const codeByUnit = new Map<string, string | null>((units ?? []).map((u: any) => [u.id, u.code]));
  const rateByCode: Record<string, UnitRateInput> = {};
  unitRates.forEach((r) => {
    const code = codeByUnit.get(r.unit_id);
    if (code) rateByCode[code] = r;
  });
  const tk = rateByCode["TAKUHAIBIN"];
  const nk = rateByCode["NEKOPOS"];

  const legacyPatch: Record<string, number> = {
    fixed_revenue: fixedRevenue,
    fixed_profit: fixedProfit,
  };
  if (tk) {
    legacyPatch.takuhaibin_revenue = num(tk.revenue_per_unit);
    legacyPatch.takuhaibin_profit = num(tk.profit_per_unit);
    legacyPatch.takuhaibin_driver_payout = num(tk.payout_per_unit);
  }
  if (nk) {
    legacyPatch.nekopos_revenue = num(nk.revenue_per_unit);
    legacyPatch.nekopos_profit = num(nk.profit_per_unit);
    legacyPatch.nekopos_driver_payout = num(nk.payout_per_unit);
  }

  // 既存 course_rates 行があれば update、無ければ insert
  const { data: existing } = await supabase
    .from("course_rates")
    .select("id")
    .eq("course_id", courseId)
    .maybeSingle();
  if (existing) {
    await supabase.from("course_rates").update(legacyPatch).eq("course_id", courseId);
  } else {
    await supabase.from("course_rates").insert({ course_id: courseId, ...legacyPatch });
  }

  return NextResponse.json({ ok: true });
}
