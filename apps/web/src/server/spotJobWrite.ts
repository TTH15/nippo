import { NextResponse } from "next/server";
import { normalizeAmount, normalizeTime, parseMembers, SPOT_JOB_STATUSES, fetchSpotJob } from "./spotJobs";
import { isDateOnly, isUuid } from "./db/adminResourceScope";
import { supabase } from "./db/client";
import { reportLifecycleError } from "./reports/lifecycleError";

export async function saveSpotJob(org: string, actor: string, id: string | null, body: any, finance: boolean, sales: boolean) {
  if (!body || typeof body !== "object") return NextResponse.json({ error: "案件の内容を確認してください" }, { status: 400 });
  if (!finance && (Object.hasOwn(body, "billingAmount") || (Array.isArray(body.members) && body.members.some((m: any) => m && Object.hasOwn(m, "payAmount"))))) return NextResponse.json({ error: "金額を変更する権限がありません" }, { status: 403 });
  const patch: Record<string, unknown> = {};
  if (id === null || body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 100) return NextResponse.json({ error: "案件名を入力してください" }, { status: 400 });
    patch.title = body.title.trim();
  }
  if (id === null || body.jobDate !== undefined) {
    if (!isDateOnly(body.jobDate)) return NextResponse.json({ error: "日付を確認してください" }, { status: 400 });
    patch.job_date = body.jobDate;
  }
  for (const [source, target, max] of [["meetingPlace", "meeting_place", 100], ["clientName", "client_name", 100], ["note", "note", 500]] as const) {
    if (body[source] !== undefined) patch[target] = typeof body[source] === "string" ? body[source].trim().slice(0, max) || null : null;
  }
  for (const [source, target] of [["meetingTime", "meeting_time"], ["endTime", "end_time"]] as const) {
    const parsed = normalizeTime(body[source]);
    if (!parsed.ok) return NextResponse.json({ error: "時刻を確認してください" }, { status: 400 });
    if (parsed.value !== undefined) patch[target] = parsed.value;
  }
  if (body.billingAmount !== undefined) {
    const parsed = normalizeAmount(body.billingAmount);
    if (!parsed.ok) return NextResponse.json({ error: "請求額を確認してください" }, { status: 400 });
    patch.billing_amount = parsed.value;
  }
  if (body.status !== undefined) {
    if (!SPOT_JOB_STATUSES.includes(body.status)) return NextResponse.json({ error: "状態を確認してください" }, { status: 400 });
    patch.status = body.status;
  }
  const parsed = parseMembers(body.members);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (id !== null && (!isUuid(id) || typeof body.expectedVersion !== "string" || !Number.isFinite(Date.parse(body.expectedVersion)))) return NextResponse.json({ error: "案件を開き直してください" }, { status: 400 });
  const members = body.members === undefined ? null : body.members.flatMap((input: any) => {
    const normalized = parseMembers([input]);
    if (!normalized.ok) return [];
    return normalized.members.map(m => ({ driver_id: m.driver_id, display_name: m.display_name,
      ...(input?.id ? { id: input.id } : {}), ...(finance ? { pay_amount: m.pay_amount } : {}) }));
  });
  if (members?.some((m: any) => (m.id && !isUuid(m.id)) || (m.driver_id && !isUuid(m.driver_id)))) return NextResponse.json({ error: "参加者を確認してください" }, { status: 400 });
  const { data, error } = await supabase.rpc("save_spot_job", { p_org: org, p_actor: actor, p_id: id, p_patch: patch, p_members: members, p_finance: finance, p_expected: body.expectedVersion ?? null });
  if (error?.code === "42501") return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  if (error) return reportLifecycleError(error, "案件を保存できませんでした。入力を残して再試行してください");
  const job = await fetchSpotJob(org, data, { sales, profit: finance });
  return NextResponse.json({ job });
}
