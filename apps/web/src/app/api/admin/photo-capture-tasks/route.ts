import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { parsePhotoCaptureTasks } from "@repo/core/logic/photoCapturePolicy";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { data, error } = await supabase.from("organizations")
    .select("photo_capture_tasks, photo_capture_tasks_version").eq("id", orgId).maybeSingle();
  if (error || !data) return NextResponse.json({ error: "撮影項目を取得できませんでした" }, { status: 500 });
  const tasks = parsePhotoCaptureTasks(data.photo_capture_tasks);
  if (!tasks) return NextResponse.json({ error: "撮影項目を確認できませんでした" }, { status: 500 });
  return NextResponse.json({ tasks, version: data.photo_capture_tasks_version });
}

export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_org_settings");
  if (isAuthError(user)) return user;
  const body = await req.json().catch(() => ({}));
  const tasks = parsePhotoCaptureTasks(body.tasks);
  const version = body.version;
  if (!tasks || !Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "撮影項目を確認してください" }, { status: 400 });
  }
  const orgId = await resolveOrgId(user.driverId);
  const { data, error } = await supabase.from("organizations")
    .update({ photo_capture_tasks: tasks, photo_capture_tasks_version: version + 1 })
    .eq("id", orgId).eq("photo_capture_tasks_version", version)
    .select("photo_capture_tasks_version").maybeSingle();
  if (error) return NextResponse.json({ error: "撮影項目を保存できませんでした" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "別の管理者が先に変更しました。読み直してください" }, { status: 409 });
  return NextResponse.json({ tasks, version: data.photo_capture_tasks_version });
}
