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

// GET: 月の単発案件一覧＋参加者ピッカー候補 ?month=YYYY-MM
// 候補は「正規ドライバー（works_as_driver）＋ゲスト（member_kind='guest'）」。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
  }
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

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
    jobs: (jobs ?? []).map((j) => serializeSpotJob(j, membersByJob.get(j.id) ?? [])),
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

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 100) {
    return NextResponse.json({ error: "案件名は1〜100文字で入力してください" }, { status: 400 });
  }
  const jobDate = typeof body.jobDate === "string" ? body.jobDate : "";
  if (!DATE_RE.test(jobDate)) {
    return NextResponse.json({ error: "日付が不正です" }, { status: 400 });
  }
  const meetingTime = normalizeTime(body.meetingTime);
  const endTime = normalizeTime(body.endTime);
  if (!meetingTime.ok || !endTime.ok) {
    return NextResponse.json({ error: "時刻の形式が不正です" }, { status: 400 });
  }
  const billingAmount = normalizeAmount(body.billingAmount);
  if (!billingAmount.ok) {
    return NextResponse.json({ error: "請求額（参考）が不正です" }, { status: 400 });
  }
  const status =
    body.status === undefined
      ? "planned"
      : SPOT_JOB_STATUSES.includes(body.status as (typeof SPOT_JOB_STATUSES)[number])
        ? (body.status as string)
        : null;
  if (!status) return NextResponse.json({ error: "状態の指定が不正です" }, { status: 400 });

  const parsed = parseMembers(body.members);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!(await verifyDriversInOrg(orgId, parsed.members))) {
    return NextResponse.json({ error: "参加者の指定が不正です" }, { status: 400 });
  }

  const insertRow = {
    org_id: orgId,
    title,
    job_date: jobDate,
    meeting_place: typeof body.meetingPlace === "string" ? body.meetingPlace.trim().slice(0, 100) || null : null,
    meeting_time: meetingTime.value ?? null,
    end_time: endTime.value ?? null,
    client_name: typeof body.clientName === "string" ? body.clientName.trim().slice(0, 100) || null : null,
    billing_amount: billingAmount.value ?? null,
    note: typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null,
    status,
    created_by: user.driverId,
  };

  const { data: job, error } = await supabase
    .from("spot_jobs") // tenant-scope-ok: insertRow に org_id: orgId を含む（上記 insertRow 定義）
    .insert(insertRow)
    .select(SPOT_JOB_COLUMNS)
    .single();

  if (error || !job) {
    console.error("[spot-jobs] insert error", error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }

  if (parsed.members.length > 0) {
    const { error: memberError } = await supabase
      .from("spot_job_members")
      .insert(parsed.members.map((m) => ({ ...m, job_id: job.id })));
    if (memberError) {
      console.error("[spot-jobs] member insert error", memberError);
      // 参加者が保存できなかった中途半端な案件を残さない（ベストエフォートで巻き戻す）
      await supabase.from("spot_jobs").delete().eq("id", job.id).eq("org_id", orgId);
      return NextResponse.json({ error: "参加者の保存に失敗しました" }, { status: 500 });
    }
  }

  const members = await loadMembers([job.id]).catch(() => new Map());
  return NextResponse.json({ job: serializeSpotJob(job, members.get(job.id) ?? []) });
}
