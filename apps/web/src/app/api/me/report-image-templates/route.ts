import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { toImageTemplate, type TemplateRow } from "@/server/reports/imageTemplates";

export const dynamic = "force-dynamic";

// ============================================================
// 日報の「画像から入力」で使う様式。運用中(active)のものだけを返す。
// 読み取りは端末内で行うので、ここでは様式（見出しと位置の決め）だけを渡す。
// 見本画像は渡さない（管理の資料であって、本人の読み取りには要らない）。
//
// あわせて「目視確認を省いてよいコース」を返す（migration 182）。
// 件数が報酬に効かないコース向けの設定で、食い違いのある読み取りには効かない。
// ============================================================
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const driverId = user.driverId as string;
  const orgId = user.orgId ?? (await resolveOrgId(driverId));

  const { data, error } = await supabase
    .from("report_image_templates")
    .select("id, carrier_id, template_key, version, name, status, definition, sample_storage_path, sample_width, sample_height, note, updated_at")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("template_key");
  if (error) {
    // migration 181 未適用でも日報画面は開ける（手入力のまま）
    return NextResponse.json({ templates: [], autoFillCourseIds: [], unavailable: true });
  }
  const { data: courses } = await supabase
    .from("courses")
    .select("id")
    .eq("org_id", orgId)
    .eq("report_image_auto_fill", true)
    .is("archived_at", null);

  return NextResponse.json({
    templates: ((data ?? []) as TemplateRow[]).map(toImageTemplate),
    autoFillCourseIds: (courses ?? []).map((row) => row.id as string),
    unavailable: false,
  });
}
