import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadAllRules, saveRules, type DeadlineRuleInput } from "@/server/shiftDeadline/config";
import type { RulePeriod, RulePeriodOverride } from "@/lib/shiftDeadline";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toInt = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const clampDay = (d: number) => (d < 1 ? 1 : d > 28 ? 28 : d); // 締切日は1-28（月末ズレ防止）
const clampRange = (d: number) => (d < 1 ? 1 : d > 31 ? 31 : d);
const clampOffset = (o: number) => (o < -2 ? -2 : o > 2 ? 2 : o);

// GET: ルール一覧 + ドライバー一覧
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const [rules, { data: drivers }] = await Promise.all([
    loadAllRules(supabase),
    // 実ドライバーのみ（管理者・閲覧専用アカウントは除外）。
    supabase.from("drivers").select("id, name, display_name").eq("role", "DRIVER").order("name"),
  ]);
  return NextResponse.json({ rules, drivers: drivers ?? [] });
}

// PUT: ルールを全置換で保存
export async function PUT(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const rawRules = Array.isArray(body.rules) ? body.rules : [];

  const rules: DeadlineRuleInput[] = [];
  for (const r of rawRules as Record<string, unknown>[]) {
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : "ルール";

    const rawPeriods = Array.isArray(r.periods) ? r.periods : [];
    const periods: Omit<RulePeriod, "seq">[] = [];
    for (const p of rawPeriods as Record<string, unknown>[]) {
      const startDay = clampRange(toInt(p.startDay, 1));
      const endDay = clampRange(toInt(p.endDay, 31));
      periods.push({
        startDay,
        endDay: Math.max(startDay, endDay),
        deadlineMonthOffset: clampOffset(toInt(p.deadlineMonthOffset, -1)),
        deadlineDay: clampDay(toInt(p.deadlineDay, 23)),
      });
    }

    const rawOverrides = Array.isArray(r.overrides) ? r.overrides : [];
    const seenOv = new Set<string>();
    const overrides: RulePeriodOverride[] = [];
    for (const o of rawOverrides as Record<string, unknown>[]) {
      const targetYear = toInt(o.targetYear, 0);
      const targetMonth = toInt(o.targetMonth, 0);
      const periodSeq = toInt(o.periodSeq, -1);
      const deadlineDate = typeof o.deadlineDate === "string" ? o.deadlineDate : "";
      if (targetYear < 2000 || targetMonth < 1 || targetMonth > 12) continue;
      if (periodSeq < 0 || periodSeq >= periods.length) continue; // 存在する期間のみ
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) continue;
      const key = `${targetYear}-${targetMonth}-${periodSeq}`;
      if (seenOv.has(key)) continue;
      seenOv.add(key);
      overrides.push({
        targetYear,
        targetMonth,
        periodSeq,
        deadlineDate,
        note: typeof o.note === "string" && o.note.trim() ? o.note.trim() : null,
      });
    }

    const rawDriverIds = Array.isArray(r.driverIds) ? r.driverIds : [];
    const driverIds = (rawDriverIds as unknown[]).filter(
      (d): d is string => typeof d === "string" && UUID_RE.test(d),
    );

    rules.push({ name, periods, overrides, driverIds });
  }

  try {
    await saveRules(supabase, rules);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "保存に失敗しました（migration 075 未適用の可能性）" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
