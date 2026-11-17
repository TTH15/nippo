import { saveSpotJob } from "@/server/spotJobWrite";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import {
  DATE_RE,
  SPOT_JOB_COLUMNS,
  SPOT_JOB_STATUSES,
  loadMembers,
  normalizeAmount,
  normalizeTime,
  parseMembers,
  serializeSpotJob,
  verifyDriversInOrg,
} from "@/server/spotJobs";

export const dynamic = "force-dynamic";

// GET: 単発案件一覧＋参加者ピッカー候補
//   ?month=YYYY-MM または ?start=YYYY-MM-DD&end=YYYY-MM-DD（シフト画面の表示期間に合わせる用）
// 候補は「正規ドライバー（works_as_driver）＋ゲスト（member_kind='guest'）」。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  let start: string;
  let end: string;
  const month = req.nextUrl.searchParams.get("month");
  if (month !== null) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
    }
    const [y, m] = month.split("-").map(Number);
    start = `${month}-01`;
    end = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  } else {
    start = req.nextUrl.searchParams.get("start") ?? "";
    end = req.nextUrl.searchParams.get("end") ?? "";
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json({ error: "month か start/end を指定してください" }, { status: 400 });
    }
  }

  const { data: jobs, error } = await supabase
    .from("spot_jobs")
    .select(SPOT_JOB_COLUMNS)
    .eq("org_id", orgId)
    .gte("job_date", start)
    .lte("job_date", end)
    .order("job_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[spot-jobs] list error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const { data: drivers, error: driversError } = await supabase
    .from("drivers")
    .select("id, name, display_name, member_kind")
    .eq("org_id", orgId)
    .eq("status", "active")
    .or("works_as_driver.eq.true,member_kind.eq.guest")
    .order("name");

  if (driversError) {
    console.error("[spot-jobs] drivers error", driversError);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  let membersByJob: Awaited<ReturnType<typeof loadMembers>>;
  try {
    membersByJob = await loadMembers((jobs ?? []).map((j) => j.id));
  } catch (e) {
    console.error("[spot-jobs] members error", e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({
    jobs: (jobs ?? []).map((j) => serializeSpotJob(j, membersByJob.get(j.id) ?? [], {
      sales: user.capabilities?.has("can_view_sales") === true,
      profit: user.capabilities?.has("can_view_profit") === true,
    })),
    drivers: (drivers ?? []).map((d) => ({
      id: d.id,
      name: d.display_name || d.name,
      isGuest: d.member_kind === "guest",
    })),
  });
}

// POST: 単発案件を作成（参加者込み）
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  return saveSpotJob(orgId, user.driverId, null, await req.json().catch(() => null), user.capabilities?.has("can_view_sales") === true && user.capabilities.has("can_view_profit"), user.capabilities?.has("can_view_sales") === true);
}
