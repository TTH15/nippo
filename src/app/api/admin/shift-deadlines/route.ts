import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import {
  loadDeadlineConfig,
  saveDeadlineConfig,
  loadDeadlineOverrides,
  saveDeadlineOverrides,
  defaultDeadlineConfig,
} from "@/server/shiftDeadline/config";
import type { DeadlineConfig, DeadlineOverride, Half } from "@/lib/shiftDeadline";

export const dynamic = "force-dynamic";

// GET: 既定ルール + 期間例外
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const [config, overrides] = await Promise.all([
    loadDeadlineConfig(supabase),
    loadDeadlineOverrides(supabase),
  ]);
  return NextResponse.json({ config, overrides });
}

const toInt = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const HALVES: Half[] = ["FIRST", "SECOND"];

// PUT: 既定ルール + 期間例外を保存
export async function PUT(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const base = defaultDeadlineConfig();

  // 既定ルール: v1 は締切日(前月◯日/当月◯日)のみ可変。半月境界・オフセットは既定固定。
  const rawConfig = (body.config ?? {}) as Record<string, unknown>;
  const config: DeadlineConfig = {
    firstHalfEndDay: base.firstHalfEndDay,
    firstHalfDeadlineMonthOffset: base.firstHalfDeadlineMonthOffset,
    firstHalfDeadlineDay: clampDay(toInt(rawConfig.firstHalfDeadlineDay, base.firstHalfDeadlineDay)),
    secondHalfDeadlineMonthOffset: base.secondHalfDeadlineMonthOffset,
    secondHalfDeadlineDay: clampDay(
      toInt(rawConfig.secondHalfDeadlineDay, base.secondHalfDeadlineDay),
    ),
  };

  // 期間例外
  const rawOverrides = Array.isArray(body.overrides) ? body.overrides : [];
  const seen = new Set<string>();
  const overrides: DeadlineOverride[] = [];
  for (const o of rawOverrides as Record<string, unknown>[]) {
    const targetYear = toInt(o.targetYear, 0);
    const targetMonth = toInt(o.targetMonth, 0);
    const half = o.half as Half;
    const deadlineDate = typeof o.deadlineDate === "string" ? o.deadlineDate : "";
    if (targetYear < 2000 || targetMonth < 1 || targetMonth > 12) continue;
    if (!HALVES.includes(half)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) continue;
    const key = `${targetYear}-${targetMonth}-${half}`;
    if (seen.has(key)) continue; // UNIQUE 制約と整合
    seen.add(key);
    overrides.push({
      targetYear,
      targetMonth,
      half,
      deadlineDate,
      note: typeof o.note === "string" && o.note.trim() ? o.note.trim() : null,
    });
  }

  try {
    await saveDeadlineConfig(supabase, config);
    await saveDeadlineOverrides(supabase, overrides);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "保存に失敗しました（migration 066 未適用の可能性）" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, config, overrides });
}

function clampDay(d: number): number {
  if (d < 1) return 1;
  if (d > 28) return 28; // 月末安全（締切日は1-28に制限）
  return d;
}
