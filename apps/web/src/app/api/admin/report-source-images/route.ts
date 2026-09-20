import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";
import {
  flagDuplicates,
  mergeReadingValues,
  reviewReasons,
  type ReviewValue,
} from "@/server/reports/sourceImageReview";
import type { ImageTemplateDefinition } from "@repo/core/logic/reportImageTemplate";

export const dynamic = "force-dynamic";

// ============================================================
// 管理側で原本画像と読み取りを確認する一覧。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-4）
//
// 自社ぶんだけを返す。原本そのものはここでは返さず、別の署名URLで渡す。
// 読み取っただけの値と、本人が確認して集計へ渡った値（adopted）を分けて出す。
// ============================================================

const MAX_DAYS = 62;

const shiftDate = (date: string, days: number): string => {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(time)) return date;
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
};

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_reports");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const today = todayJST();
  const isDate = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const rawTo = req.nextUrl.searchParams.get("to");
  const rawFrom = req.nextUrl.searchParams.get("from");
  const to = isDate(rawTo) ? rawTo : today;
  const from = isDate(rawFrom) ? rawFrom : shiftDate(to, -6);
  // 範囲を広げすぎない（原本は重い・一覧は確認のための窓）
  const start = Date.parse(`${from}T00:00:00Z`) < Date.parse(`${to}T00:00:00Z`) - MAX_DAYS * 86_400_000
    ? shiftDate(to, -MAX_DAYS)
    : from;
  const status = req.nextUrl.searchParams.get("status");

  let query = supabase
    .from("report_source_images")
    .select(
      "id, driver_id, report_date, course_id, status, received_at, captured_at, captured_at_source, sha256, byte_size, original_filename, supersedes_id",
    )
    .eq("org_id", orgId)
    .gte("report_date", start)
    .lte("report_date", to)
    .order("report_date", { ascending: false })
    .order("received_at", { ascending: false })
    .limit(500);
  if (status && status !== "all") query = query.eq("status", status);

  const { data: images, error } = await query;
  if (error) {
    console.error("[admin/report-source-images] load error", error);
    // migration 169/181 未適用でも画面は開ける
    return NextResponse.json({ images: [], unavailable: true, from: start, to });
  }
  if ((images ?? []).length === 0) {
    return NextResponse.json({ images: [], unavailable: false, from: start, to });
  }

  const imageIds = (images ?? []).map((row) => row.id as string);
  const driverIds = Array.from(new Set((images ?? []).map((row) => row.driver_id as string)));
  const courseIds = Array.from(new Set((images ?? []).map((row) => row.course_id as string | null).filter(Boolean))) as string[];

  const [{ data: readings }, { data: drivers }, { data: courses }] = await Promise.all([
    supabase
      .from("report_source_image_readings")
      .select("id, source_image_id, template_key, template_version, extracted, corrected, adopted, confirmed_at, created_at")
      .eq("org_id", orgId)
      .in("source_image_id", imageIds)
      .order("created_at", { ascending: false }),
    supabase.from("drivers").select("id, name, display_name").eq("org_id", orgId).in("id", driverIds),
    courseIds.length
      ? supabase.from("courses").select("id, name").eq("org_id", orgId).in("id", courseIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  // 読み取りに使った様式（その版）から項目名を引く
  const templateKeys = Array.from(new Set((readings ?? []).map((row) => row.template_key as string | null).filter(Boolean))) as string[];
  const { data: templates } = templateKeys.length
    ? await supabase
        .from("report_image_templates")
        .select("template_key, version, name, definition")
        .eq("org_id", orgId)
        .in("template_key", templateKeys)
    : { data: [] as { template_key: string; version: number; name: string; definition: ImageTemplateDefinition }[] };

  const templateOf = (key: string | null, version: string | null) =>
    (templates ?? []).find((row) => row.template_key === key && String(row.version) === String(version)) ?? null;
  const driverName = new Map(
    (drivers ?? []).map((row) => [row.id as string, (row.display_name as string) || (row.name as string)]),
  );
  const courseName = new Map((courses ?? []).map((row) => [row.id as string, row.name as string]));

  const duplicates = flagDuplicates(
    (images ?? []).map((row) => ({
      id: row.id as string,
      driverId: row.driver_id as string,
      reportDate: row.report_date as string,
      sha256: row.sha256 as string,
    })),
  );

  const rows = (images ?? []).map((image) => {
    const own = (readings ?? []).filter((row) => row.source_image_id === image.id);
    // 集計へ渡った版を優先し、無ければ最後に読んだ版を見せる
    const reading = own.find((row) => row.adopted) ?? own[0] ?? null;
    const template = reading ? templateOf(reading.template_key as string | null, reading.template_version as string | null) : null;
    const values: ReviewValue[] = reading
      ? mergeReadingValues(reading.extracted, reading.corrected, (template?.definition as ImageTemplateDefinition) ?? null)
      : [];
    const extractedReadDate =
      reading && typeof (reading.extracted as { readDate?: unknown })?.readDate === "string"
        ? ((reading.extracted as { readDate: string }).readDate)
        : null;

    return {
      id: image.id,
      reportDate: image.report_date,
      driverId: image.driver_id,
      driverName: driverName.get(image.driver_id as string) ?? "（不明）",
      courseName: image.course_id ? (courseName.get(image.course_id as string) ?? null) : null,
      status: image.status,
      receivedAt: image.received_at,
      capturedAt: image.captured_at,
      capturedAtSource: image.captured_at_source,
      byteSize: image.byte_size,
      originalFilename: image.original_filename,
      supersedesId: image.supersedes_id,
      templateName: template?.name ?? null,
      templateKey: reading?.template_key ?? null,
      templateVersion: reading?.template_version ?? null,
      adopted: !!reading?.adopted,
      confirmedAt: reading?.confirmed_at ?? null,
      readingCount: own.length,
      values,
      duplicate: duplicates[image.id as string] ?? "none",
      reasons: reviewReasons({
        id: image.id as string,
        reportDate: image.report_date as string,
        status: image.status as string,
        capturedAt: image.captured_at as string | null,
        capturedAtSource: image.captured_at_source as "exif" | "photo_library" | "unknown",
        duplicate: duplicates[image.id as string] ?? "none",
        readDate: extractedReadDate,
        values,
      }),
    };
  });

  return NextResponse.json({ images: rows, unavailable: false, from: start, to });
}
