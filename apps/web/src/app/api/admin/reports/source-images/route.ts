import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { resolveStoredUrls } from "@/server/storage/dataUrl";
import { SOURCE_IMAGE_BUCKET } from "@/server/reports/sourceImages";

export const dynamic = "force-dynamic";

// ============================================================
// 運営が日報の原本画像を見る（RIMG-4 の入口）。
// 設計: docs/design/report-image-evidence-2026-09.md
//
// 原本は非公開バケット。ここでは短時間の署名URLだけを返し、パスは自社の
// プレフィックス（org_id/...）に収まるものに限る（他社の原本を掴めないように）。
// 件数の確認・採用版の記録（RIMG-4 本体）はまだ無い。
// ============================================================

const isDateOnly = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
/** 署名の有効時間。原本は見るだけなので短く */
const SIGNED_URL_SECONDS = 10 * 60;
const MAX_ROWS = 200;

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const date = req.nextUrl.searchParams.get("date");
  if (!isDateOnly(date)) {
    return NextResponse.json({ error: "対象日を指定してください" }, { status: 400 });
  }
  const driverId = req.nextUrl.searchParams.get("driverId");

  let query = supabase
    .from("report_source_images")
    .select("id, driver_id, report_date, course_id, status, storage_path, byte_size, mime, width, height, original_filename, received_at, captured_at, captured_at_source, file_modified_at, supersedes_id")
    .eq("org_id", orgId)
    .eq("report_date", date)
    .order("received_at", { ascending: false })
    .order("id")
    .limit(MAX_ROWS);
  if (driverId) query = query.eq("driver_id", driverId);

  const { data, error } = await query;
  if (error) {
    console.error("[admin/report source images] load error", error);
    // migration 169 未適用でも日報画面は開けるようにする
    return NextResponse.json({ images: [], unavailable: true });
  }
  const rows = data ?? [];
  if (rows.length === 0) return NextResponse.json({ images: [], unavailable: false });

  // 自社プレフィックス（org_id/...）の外を指すパスには署名しない
  const urls = await resolveStoredUrls(
    supabase,
    SOURCE_IMAGE_BUCKET,
    rows.map((row) => row.storage_path as string),
    orgId,
    SIGNED_URL_SECONDS,
  );

  const driverIds = [...new Set(rows.map((row) => row.driver_id as string))];
  const { data: drivers } = await supabase
    .from("drivers").select("id, name, display_name").eq("org_id", orgId).in("id", driverIds);
  const nameById = new Map((drivers ?? []).map((d) => [d.id as string, d.display_name || d.name || ""]));

  const images = rows.map((row, index) => ({
    id: row.id as string,
    driverId: row.driver_id as string,
    driverName: nameById.get(row.driver_id as string) ?? "",
    status: row.status as string,
    byteSize: Number(row.byte_size) || 0,
    mime: row.mime as string,
    width: (row.width as number | null) ?? null,
    height: (row.height as number | null) ?? null,
    originalFilename: (row.original_filename as string | null) ?? null,
    receivedAt: row.received_at as string,
    // 取得元が unknown なら作成日時は無い。受領日時で代用しない
    capturedAt: (row.captured_at as string | null) ?? null,
    capturedAtSource: row.captured_at_source as string,
    fileModifiedAt: (row.file_modified_at as string | null) ?? null,
    supersedesId: (row.supersedes_id as string | null) ?? null,
    url: urls[index] ?? null,
  }));
  return NextResponse.json({ images, unavailable: false });
}
