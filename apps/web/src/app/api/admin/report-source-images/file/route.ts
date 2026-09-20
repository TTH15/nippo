import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { SOURCE_IMAGE_BUCKET } from "@/server/reports/sourceImages";

export const dynamic = "force-dynamic";

// ============================================================
// 原本そのものを見るための短時間URL。
// 自社の原本だけを渡す（保存パスを直接指定させない）。一覧には画像を載せない。
// ============================================================
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "原本を指定してください" }, { status: 400 });

  const { data: image, error } = await supabase
    .from("report_source_images")
    .select("storage_path")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) {
    console.error("[admin/report-source-images/file] load error", error);
    return NextResponse.json({ error: "原本を確認できませんでした" }, { status: 500 });
  }
  if (!image?.storage_path) return NextResponse.json({ error: "原本が見つかりません" }, { status: 404 });

  const { data } = await supabase.storage
    .from(SOURCE_IMAGE_BUCKET)
    .createSignedUrl(image.storage_path as string, 300);
  return NextResponse.json({ url: data?.signedUrl ?? null });
}
