import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import {
  DATE_RE,
  SPOT_JOB_STATUSES,
  fetchSpotJob,
  normalizeAmount,
  normalizeTime,
  parseMembers,
  verifyDriversInOrg,
} from "@/server/spotJobs";

export const dynamic = "force-dynamic";

const NOT_FOUND = () => NextResponse.json({ error: "案件が見つかりません" }, { status: 404 });

// PATCH: 単発案件の編集。members を渡すと参加者を丸ごと置き換える。
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: existing, error: findError } = await supabase
    .from("spot_jobs")
    .select("id")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (findError) {
    console.error("[spot-jobs] find error", findError);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!existing) return NOT_FOUND();

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 100) {
      return NextResponse.json({ error: "案件名は1〜100文字で入力してください" }, { status: 400 });
    }
    updates.title = title;
  }
  if (body.jobDate !== undefined) {
    if (typeof body.jobDate !== "string" || !DATE_RE.test(body.jobDate)) {
      return NextResponse.json({ error: "日付が不正です" }, { status: 400 });
    }
    updates.job_date = body.jobDate;
  }
  const meetingTime = normalizeTime(body.meetingTime);
  const endTime = normalizeTime(body.endTime);
  if (!meetingTime.ok || !endTime.ok) {
    return NextResponse.json({ error: "時刻の形式が不正です" }, { status: 400 });
  }
  if (meetingTime.value !== undefined) updates.meeting_time = meetingTime.value;
  if (endTime.value !== undefined) updates.end_time = endTime.value;
  if (body.meetingPlace !== undefined) {
    updates.meeting_place =
      typeof body.meetingPlace === "string" ? body.meetingPlace.trim().slice(0, 100) || null : null;
  }
  if (body.clientName !== undefined) {
    updates.client_name = typeof body.clientName === "string" ? body.clientName.trim().slice(0, 100) || null : null;
  }
  const billingAmount = normalizeAmount(body.billingAmount);
  if (!billingAmount.ok) {
    return NextResponse.json({ error: "請求額（参考）が不正です" }, { status: 400 });
  }
  if (billingAmount.value !== undefined) updates.billing_amount = billingAmount.value;
  if (body.note !== undefined) {
    updates.note = typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  }
  if (body.status !== undefined) {
    if (!SPOT_JOB_STATUSES.includes(body.status as (typeof SPOT_JOB_STATUSES)[number])) {
      return NextResponse.json({ error: "状態の指定が不正です" }, { status: 400 });
    }
    updates.status = body.status;
  }

  const replaceMembers = body.members !== undefined;
  if (Object.keys(updates).length === 0 && !replaceMembers) {
    return NextResponse.json({ error: "変更内容がありません" }, { status: 400 });
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const { error } = await supabase.from("spot_jobs").update(updates).eq("id", id).eq("org_id", orgId);
    if (error) {
      console.error("[spot-jobs] update error", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
  }

  if (replaceMembers) {
    const parsed = parseMembers(body.members);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (!(await verifyDriversInOrg(orgId, parsed.members))) {
      return NextResponse.json({ error: "参加者の指定が不正です" }, { status: 400 });
    }
    // 丸ごと置き換え（参加者は少人数の想定。org 確認は上の existing チェックで済んでいる）
    const { error: deleteError } = await supabase.from("spot_job_members").delete().eq("job_id", id);
    if (deleteError) {
      console.error("[spot-jobs] member delete error", deleteError);
      return NextResponse.json({ error: "参加者の保存に失敗しました" }, { status: 500 });
    }
    if (parsed.members.length > 0) {
      const { error: insertError } = await supabase
        .from("spot_job_members")
        .insert(parsed.members.map((m) => ({ ...m, job_id: id })));
      if (insertError) {
        console.error("[spot-jobs] member insert error", insertError);
        return NextResponse.json({ error: "参加者の保存に失敗しました。再度保存してください" }, { status: 500 });
      }
    }
  }

  try {
    const job = await fetchSpotJob(orgId, id);
    if (!job) return NOT_FOUND();
    return NextResponse.json({ job });
  } catch (e) {
    console.error("[spot-jobs] refetch error", e);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}

// DELETE: 単発案件を削除（参加者は CASCADE で消える）
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const { error } = await supabase.from("spot_jobs").delete().eq("id", id).eq("org_id", orgId);
  if (error) {
    console.error("[spot-jobs] delete error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
