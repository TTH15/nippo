import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// 原本画像の読み取りと、本人が確認した値の記録。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-3）
//
// ここが守ること:
//   - 読み取った値（extracted）と本人が直した値（corrected）を別に残す
//   - 集計へ渡すのは本人が確認した1版だけ（adopted）。読み取っただけの値は渡さない
//   - 確定済みの読み取りを、あとからの再読み取りで黙って上書きしない
//   - 原本は本人のものに限る（他人の原本に読み取りを足せない）
// ============================================================

const MAX_JSON_BYTES = 20_000;

const sizeOk = (value: unknown): boolean => {
  if (value == null) return true;
  try {
    return JSON.stringify(value).length <= MAX_JSON_BYTES;
  } catch {
    return false;
  }
};

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const driverId = user.driverId as string;
  const orgId = user.orgId ?? (await resolveOrgId(driverId));

  const body = await req.json().catch(() => ({}));
  const sourceImageId = typeof body.sourceImageId === "string" ? body.sourceImageId : "";
  if (!sourceImageId) return NextResponse.json({ error: "原本を指定してください" }, { status: 400 });
  if (!sizeOk(body.extracted) || !sizeOk(body.corrected)) {
    return NextResponse.json({ error: "読み取りの内容が大きすぎます" }, { status: 400 });
  }

  const templateKey = typeof body.templateKey === "string" ? body.templateKey.slice(0, 60) : null;
  const templateVersion = body.templateVersion != null ? String(body.templateVersion).slice(0, 30) : null;
  const adopted = body.adopted === true;

  // 自分の原本か（他人の原本に読み取りを足させない）
  const { data: image, error: imageError } = await supabase
    .from("report_source_images")
    .select("id, status")
    .eq("id", sourceImageId)
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .maybeSingle();
  if (imageError) {
    console.error("[reports/source-images/readings] load error", imageError);
    return NextResponse.json({ error: "原本を確認できませんでした" }, { status: 500 });
  }
  if (!image) return NextResponse.json({ error: "原本が見つかりません" }, { status: 404 });

  if (adopted) {
    // 採用は1版だけ（migration 169 の部分ユニーク索引）。前の採用を外してから入れ替える
    const { error: clearError } = await supabase
      .from("report_source_image_readings")
      .update({ adopted: false })
      .eq("source_image_id", sourceImageId)
      .eq("org_id", orgId)
      .eq("adopted", true);
    if (clearError) {
      console.error("[reports/source-images/readings] clear error", clearError);
      return NextResponse.json({ error: "確認した値を保存できませんでした" }, { status: 500 });
    }
  }

  const now = new Date().toISOString();
  // tenant-scope-ok: org_id は認証済みの所属、原本は上で本人のものと確認済み
  const { data, error } = await supabase
    .from("report_source_image_readings")
    .insert({
      org_id: orgId,
      source_image_id: sourceImageId,
      template_key: templateKey,
      template_version: templateVersion,
      extracted: body.extracted ?? null,
      corrected: adopted ? (body.corrected ?? null) : null,
      confirmed_by: adopted ? driverId : null,
      confirmed_at: adopted ? now : null,
      adopted,
    })
    .select("id, adopted, created_at")
    .single();
  if (error || !data) {
    console.error("[reports/source-images/readings] insert error", error);
    return NextResponse.json({ error: "読み取りを保存できませんでした" }, { status: 400 });
  }

  // 原本の状態を進める。読めただけの段階を「提出完了」と扱わない
  const nextStatus = adopted ? "confirmed" : templateKey ? "needs_review" : "unsupported";
  await supabase
    .from("report_source_images")
    .update({ status: nextStatus, updated_at: now })
    .eq("id", sourceImageId)
    .eq("org_id", orgId)
    .eq("driver_id", driverId);

  return NextResponse.json({ reading: data, status: nextStatus });
}

/** その原本の読み取り履歴（本人のもののみ） */
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const driverId = user.driverId as string;
  const orgId = user.orgId ?? (await resolveOrgId(driverId));
  const sourceImageId = req.nextUrl.searchParams.get("sourceImageId");
  if (!sourceImageId) return NextResponse.json({ error: "原本を指定してください" }, { status: 400 });

  const { data: image } = await supabase
    .from("report_source_images")
    .select("id")
    .eq("id", sourceImageId)
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .maybeSingle();
  if (!image) return NextResponse.json({ error: "原本が見つかりません" }, { status: 404 });

  const { data, error } = await supabase
    .from("report_source_image_readings")
    .select("id, template_key, template_version, extracted, corrected, adopted, confirmed_at, created_at")
    .eq("source_image_id", sourceImageId)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ readings: [] });
  return NextResponse.json({ readings: data ?? [] });
}
