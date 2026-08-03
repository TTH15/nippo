import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// コース側からの担当ドライバー割当（ドライバー編集の courseIds と同じ driver_courses を操作する）。
// 「コースを作ってそのまま担当を決めたい」導線用（2026-08-03）。
// 権限はコース管理・メンバー管理のどちらかで許可（両ドメインにまたがる操作のため）。
const CAPS = ["can_manage_courses", "can_manage_members"] as const;

/** そのコースを担当しているドライバー（driver_courses → driver_identities → drivers）。 */
async function loadAssigned(courseId: string, orgId: string) {
  const { data } = await supabase
    .from("driver_courses")
    .select("driver_identity_id, driver_identities ( id, slot, driver_id, drivers ( id, org_id ) )")
    .eq("course_id", courseId);
  const rows = (data ?? []) as unknown as Array<{
    driver_identity_id: string;
    driver_identities: { id: string; slot: number; driver_id: string; drivers: { id: string; org_id: string } | null } | null;
  }>;
  // 他社行が混ざらないようアプリ層で必ず org を確認する（構成A・RLS 不使用）
  return rows.filter((r) => r.driver_identities?.drivers?.org_id === orgId);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyPermission(req, [...CAPS]);
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const { id: courseId } = await params;

  const assigned = await loadAssigned(courseId, orgId);
  return NextResponse.json({
    driverIds: Array.from(new Set(assigned.map((r) => r.driver_identities!.driver_id))),
  });
}

// PUT: 担当ドライバーを一括更新。{ driverIds: string[] }
// 既存行は「勤務区分（slot）」を保つため、選択が続いているドライバーの行はそのまま残す。
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyPermission(req, [...CAPS]);
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const { id: courseId } = await params;

  const body = await req.json().catch(() => ({}));
  const driverIds: string[] = Array.isArray(body.driverIds)
    ? body.driverIds.filter((x: unknown): x is string => typeof x === "string")
    : [];

  // コースの所属 org を確認（他社コースへの書き込みを防ぐ）
  const { data: course } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!course) {
    return NextResponse.json({ error: "コースが見つかりません" }, { status: 404 });
  }

  const wanted = new Set(driverIds);
  const assigned = await loadAssigned(courseId, orgId);
  const assignedDriverIds = new Set(assigned.map((r) => r.driver_identities!.driver_id));

  // 外す: 選択から消えたドライバーの行（そのドライバーの全 slot 分）
  const removeIdentityIds = assigned
    .filter((r) => !wanted.has(r.driver_identities!.driver_id))
    .map((r) => r.driver_identity_id);
  if (removeIdentityIds.length > 0) {
    const { error } = await supabase
      .from("driver_courses")
      .delete()
      .eq("course_id", courseId)
      .in("driver_identity_id", removeIdentityIds);
    if (error) {
      console.error("[courses/drivers] delete error", error);
      return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
    }
  }

  // 追加: 新しく選ばれたドライバー。勤務区分は既定（slot が最小＝区分1）に紐づける。
  const addDriverIds = driverIds.filter((id) => !assignedDriverIds.has(id));
  const skipped: string[] = [];
  if (addDriverIds.length > 0) {
    const { data: idRows } = await supabase
      .from("driver_identities")
      .select("id, driver_id, slot, drivers!inner ( org_id )")
      .in("driver_id", addDriverIds)
      .eq("drivers.org_id", orgId)
      .order("slot", { ascending: true });
    const firstIdentityByDriver = new Map<string, string>();
    ((idRows ?? []) as Array<{ id: string; driver_id: string }>).forEach((r) => {
      if (!firstIdentityByDriver.has(r.driver_id)) firstIdentityByDriver.set(r.driver_id, r.id);
    });
    const rows = addDriverIds
      .map((driverId) => {
        const identityId = firstIdentityByDriver.get(driverId);
        if (!identityId) {
          skipped.push(driverId); // 勤務区分が未作成（未承認等）のドライバーは対象外
          return null;
        }
        return { driver_identity_id: identityId, course_id: courseId };
      })
      .filter((r): r is { driver_identity_id: string; course_id: string } => r !== null);
    if (rows.length > 0) {
      const { error } = await supabase.from("driver_courses").upsert(rows, {
        onConflict: "driver_identity_id,course_id",
      });
      if (error) {
        console.error("[courses/drivers] insert error", error);
        return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true, skippedDriverIds: skipped });
}
