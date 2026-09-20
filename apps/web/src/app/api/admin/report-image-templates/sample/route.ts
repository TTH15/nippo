import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { verifyFileContent } from "@/server/storage/fileSignature";
import {
  TEMPLATE_SAMPLE_BUCKET,
  TEMPLATE_SAMPLE_MAX_BYTES,
  TEMPLATE_SAMPLE_MIME,
} from "@/server/reports/imageTemplates";

export const dynamic = "force-dynamic";

// ============================================================
// 様式の見本画像。管理画面で枠を引き、読み取りの検証に使う。
// 非公開バケットに置き、閲覧は短時間の署名URLで渡す。
// 見本は「この画面はこう写る」の資料なので、実在の個人情報を含む画像は入れない運用とする。
// ============================================================

/** 見本を差し替える（1様式1枚） */
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_carriers");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "見本を確認してください" }, { status: 400 });
  }
  const id = form.get("id");
  const file = form.get("file");
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "様式を指定してください" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "画像を選んでください" }, { status: 400 });
  if (file.size > TEMPLATE_SAMPLE_MAX_BYTES) {
    return NextResponse.json({ error: `画像は${Math.floor(TEMPLATE_SAMPLE_MAX_BYTES / (1024 * 1024))}MBまでです` }, { status: 400 });
  }

  const { data: current } = await supabase
    .from("report_image_templates")
    .select("id, sample_storage_path")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "様式が見つかりません" }, { status: 404 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const verified = verifyFileContent(bytes, TEMPLATE_SAMPLE_MIME, file.type || undefined);
  if (!verified.ok) return NextResponse.json({ error: "対応していない画像形式です（JPEG / PNG）" }, { status: 400 });

  const width = Number(form.get("width")) || null;
  const height = Number(form.get("height")) || null;
  const extension = verified.type === "image/png" ? "png" : "jpg";
  const path = `${orgId}/${id}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(TEMPLATE_SAMPLE_BUCKET)
    .upload(path, bytes, { contentType: verified.type, upsert: false });
  if (uploadError) {
    console.error("[admin/report-image-templates/sample] upload error", uploadError);
    return NextResponse.json({ error: "見本を保存できませんでした" }, { status: 400 });
  }

  const { error } = await supabase
    .from("report_image_templates")
    .update({
      sample_storage_path: path,
      sample_width: width,
      sample_height: height,
      sample_mime: verified.type,
      updated_by: user.driverId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) {
    await supabase.storage.from(TEMPLATE_SAMPLE_BUCKET).remove([path]).catch(() => undefined);
    return NextResponse.json({ error: "見本を保存できませんでした" }, { status: 400 });
  }
  // 差し替え前の見本は残さない（参照のない画像を溜めない）
  if (current.sample_storage_path) {
    await supabase.storage
      .from(TEMPLATE_SAMPLE_BUCKET)
      .remove([current.sample_storage_path as string])
      .catch(() => undefined);
  }
  return NextResponse.json({ ok: true, width, height });
}

/** 見本を見るための短時間URL */
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_carriers");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "様式を指定してください" }, { status: 400 });

  const { data: row } = await supabase
    .from("report_image_templates")
    .select("sample_storage_path")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!row?.sample_storage_path) return NextResponse.json({ url: null });

  const { data } = await supabase.storage
    .from(TEMPLATE_SAMPLE_BUCKET)
    .createSignedUrl(row.sample_storage_path as string, 300);
  return NextResponse.json({ url: data?.signedUrl ?? null });
}
