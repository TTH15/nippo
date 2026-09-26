import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { parsePhotoCaptureTasks } from "@repo/core/logic/photoCapturePolicy";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req, "DRIVER");
  if (ctx instanceof NextResponse) return ctx;
  const { data, error } = await supabase.from("organizations")
    .select("photo_capture_tasks, photo_capture_tasks_version").eq("id", ctx.orgId).maybeSingle();
  if (error || !data) return NextResponse.json({ error: "撮影項目を取得できませんでした" }, { status: 500 });
  const tasks = parsePhotoCaptureTasks(data.photo_capture_tasks);
  if (!tasks) return NextResponse.json({ error: "撮影項目を確認できませんでした" }, { status: 500 });
  return NextResponse.json({ tasks, version: data.photo_capture_tasks_version });
}
