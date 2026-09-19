import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { adminMutationError, isDateOnly, isUuid } from "@/server/db/adminResourceScope";
import type { ReflectGroup } from "@/lib/shiftMemo/reflect";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  try {
    const body = await req.json();
    if (!body || !["preview", "apply"].includes(body.action) || !["add", "replace"].includes(body.mode)
      || !Array.isArray(body.groups) || body.groups.length === 0 || body.groups.length > 2000) {
      return NextResponse.json({ error: "反映する担当枠と期間を選んでください。" }, { status: 400 });
    }
    const seen = new Set<string>();
    let assignments = 0;
    for (const group of body.groups as ReflectGroup[]) {
      if (!group || !isDateOnly(group.date) || !isUuid(group.courseId) || !Number.isInteger(group.cycleNo) || group.cycleNo < 0
        || !Array.isArray(group.driverIds) || group.driverIds.some(id => !isUuid(id))) {
        return NextResponse.json({ error: "反映内容を選び直してください。" }, { status: 400 });
      }
      group.courseId = group.courseId.toLowerCase();
      group.driverIds = group.driverIds.map(id => id.toLowerCase());
      if (new Set(group.driverIds).size !== group.driverIds.length) return NextResponse.json({ error: "同じドライバーが重複しています。" }, { status: 400 });
      const key = `${group.date}|${group.courseId}|${group.cycleNo}`;
      if (seen.has(key)) return NextResponse.json({ error: "同じ日・コース・便が重複しています。" }, { status: 400 });
      seen.add(key);
      assignments += group.driverIds.length;
    }
    const dates = body.groups.map((g: ReflectGroup) => g.date).sort();
    if (assignments > 5000 || (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86400000 > 61) {
      return NextResponse.json({ error: "期間を2か月以内に分けて反映してください。" }, { status: 400 });
    }
    if (body.action === "apply" && (typeof body.revision !== "string" || !/^[a-f0-9]{32}$/.test(body.revision))) {
      return NextResponse.json({ error: "変更内容を確認してから反映してください。" }, { status: 400 });
    }
    const orgId = user.orgId ?? await resolveOrgId(user.driverId);
    // tenant-scope-ok: RPCは認証済みorgId/actorを受け取り、全コース・便・ドライバーを同じ会社で検証する。
    const { data, error } = await supabase.rpc("reflect_shift_memo", {
      p_org_id: orgId, p_actor_id: user.driverId, p_groups: body.groups, p_mode: body.mode,
      p_revision: body.action === "apply" ? body.revision : null,
    });
    if (error) {
      if (["42883", "PGRST202"].includes(error.code)) return NextResponse.json({ error: "シフトへの反映は準備中です。メモはこのまま使えます。" }, { status: 503 });
      throw error;
    }
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "反映内容を選び直してください。" }, { status: 400 });
    return adminMutationError(error);
  }
}
