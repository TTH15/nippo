import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import {
  parseSourceImageSubmission,
  saveSourceImage,
  SOURCE_IMAGE_MAX_BYTES,
} from "@/server/reports/sourceImages";

export const dynamic = "force-dynamic";

// ============================================================
// 日報の原本（配完個数表などのスクショ・写真）を提出する。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-2）
//
// 原本を受け取ることと、件数が読めることは別。ここは受け取りだけを行い、
// 読み取り・確認は別の処理で追う。読めない画像でも原本は保存できる。
//
// multipart/form-data:
//   file    … 原本そのもの（再圧縮・回転・切り抜きをせずに送る）
//   meta    … JSON文字列。reportDate / clientKey / capturedAt / capturedAtSource ほか
// ============================================================

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const driverId = user.driverId as string;
  const orgId = user.orgId ?? (await resolveOrgId(driverId));

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "提出の内容を確認してください" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "画像を選んでください" }, { status: 400 });
  if (file.size > SOURCE_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: `画像は${Math.floor(SOURCE_IMAGE_MAX_BYTES / (1024 * 1024))}MBまでです` }, { status: 400 });
  }

  const metaRaw = form.get("meta");
  let meta: unknown = {};
  if (typeof metaRaw === "string" && metaRaw) {
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      return NextResponse.json({ error: "提出の内容を確認してください" }, { status: 400 });
    }
  }
  // ファイルの更新日時はブラウザの File からしか取れないので、送られていなければ補う
  if (meta && typeof meta === "object" && (meta as Record<string, unknown>).fileModifiedAt == null && file.lastModified) {
    (meta as Record<string, unknown>).fileModifiedAt = new Date(file.lastModified).toISOString();
  }
  if (meta && typeof meta === "object" && (meta as Record<string, unknown>).originalFilename == null) {
    (meta as Record<string, unknown>).originalFilename = file.name;
  }

  const parsed = parseSourceImageSubmission(meta);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // コースを指定するなら自社のものに限る
  if (parsed.value.courseId) {
    const { data: course, error } = await supabase
      .from("courses")
      .select("id")
      .eq("id", parsed.value.courseId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "コースを確認できませんでした" }, { status: 500 });
    if (!course) return NextResponse.json({ error: "そのコースは選べません" }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await saveSourceImage(supabase, bytes, parsed.value, {
      orgId,
      driverId,
      declaredMime: file.type || "application/octet-stream",
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "原本を保存できませんでした";
    console.error("[reports/source-images] save failed", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** 自分が出した原本の一覧（対象日で絞る）。原本そのものはここでは返さない */
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const driverId = user.driverId as string;
  const orgId = user.orgId ?? (await resolveOrgId(driverId));
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "対象日を指定してください" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("report_source_images")
    .select("id, report_date, course_id, status, received_at, captured_at, captured_at_source, original_filename, byte_size")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .eq("report_date", date)
    .order("received_at", { ascending: false });
  if (error) {
    console.error("[reports/source-images] load error", error);
    // migration 169 未適用でも日報画面は開けるようにする
    return NextResponse.json({ images: [], unavailable: true });
  }
  return NextResponse.json({ images: data ?? [], unavailable: false });
}
