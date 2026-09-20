import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { orgOwnsCarrier } from "@/server/carriers/orgCarriers";
import {
  parseTemplateInput,
  readyForActivation,
  verifyBindings,
  type TemplateRow,
} from "@/server/reports/imageTemplates";

export const dynamic = "force-dynamic";

// ============================================================
// 原本画像の様式の管理。報告項目と同じ権限（can_manage_carriers）で扱う。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-1）
//
// 運用中(active)にできるのは、全項目が自社の報告項目へ結び付き、見本が登録された様式だけ。
// 運用中は様式ごとに1版（migration 181 の部分ユニーク索引）。版を上げると前の版は停止になる。
// ============================================================

const COLUMNS =
  "id, carrier_id, template_key, version, name, status, definition, sample_storage_path, sample_width, sample_height, note, updated_at";

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_carriers");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const { data, error } = await supabase
    .from("report_image_templates")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .order("template_key")
    .order("version", { ascending: false });
  if (error) {
    console.error("[admin/report-image-templates] load error", error);
    // migration 181 未適用でも管理画面は開けるようにする
    return NextResponse.json({ templates: [], unavailable: true });
  }
  return NextResponse.json({ templates: data ?? [], unavailable: false });
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_carriers");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const body = await req.json().catch(() => ({}));
  const parsed = parseTemplateInput(body, { allowEmpty: true });
  if (!parsed.ok) return NextResponse.json({ error: parsed.errors[0], errors: parsed.errors }, { status: 400 });

  const bindingErrors = await verifyBindings(supabase, orgId, parsed.value.definition);
  if (bindingErrors.length > 0) {
    return NextResponse.json({ error: bindingErrors[0], errors: bindingErrors }, { status: 400 });
  }
  // carriers に org_id は無い。org との結び付きは company_carriers（有効化したキャリア）
  if (parsed.value.carrierId && !(await orgOwnsCarrier(supabase, orgId, parsed.value.carrierId))) {
    return NextResponse.json({ error: "その荷主は選べません" }, { status: 400 });
  }

  // 同じ識別子があれば版を上げる。前の版は消さず、新しい版を編集中で足す
  const { data: latest } = await supabase
    .from("report_image_templates")
    .select("version")
    .eq("org_id", orgId)
    .eq("template_key", parsed.value.templateKey)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (Number(latest?.version) || 0) + 1;
  if (version > 999) return NextResponse.json({ error: "版が多すぎます" }, { status: 400 });

  // tenant-scope-ok: org_id は認証済みの所属に固定
  const { data, error } = await supabase
    .from("report_image_templates")
    .insert({
      org_id: orgId,
      carrier_id: parsed.value.carrierId,
      template_key: parsed.value.templateKey,
      version,
      name: parsed.value.name,
      note: parsed.value.note,
      definition: parsed.value.definition,
      status: "draft",
      created_by: user.driverId,
      updated_by: user.driverId,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) {
    console.error("[admin/report-image-templates] insert error", error);
    return NextResponse.json({ error: "様式を保存できませんでした" }, { status: 400 });
  }
  return NextResponse.json({ template: data });
}

export async function PATCH(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_carriers");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "様式を指定してください" }, { status: 400 });

  const { data: current } = await supabase
    .from("report_image_templates")
    .select(COLUMNS)
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle<TemplateRow>();
  if (!current) return NextResponse.json({ error: "様式が見つかりません" }, { status: 404 });

  const patch: Record<string, unknown> = { updated_by: user.driverId, updated_at: new Date().toISOString() };

  if (body.definition !== undefined || body.name !== undefined || body.carrierId !== undefined || body.note !== undefined) {
    const parsed = parseTemplateInput({
      templateKey: current.template_key,
      name: body.name ?? current.name,
      carrierId: body.carrierId !== undefined ? body.carrierId : current.carrier_id,
      note: body.note !== undefined ? body.note : current.note,
      definition: body.definition ?? current.definition,
    }, { allowEmpty: true });
    if (!parsed.ok) return NextResponse.json({ error: parsed.errors[0], errors: parsed.errors }, { status: 400 });
    const bindingErrors = await verifyBindings(supabase, orgId, parsed.value.definition);
    if (bindingErrors.length > 0) {
      return NextResponse.json({ error: bindingErrors[0], errors: bindingErrors }, { status: 400 });
    }
    patch.name = parsed.value.name;
    patch.note = parsed.value.note;
    patch.carrier_id = parsed.value.carrierId;
    patch.definition = parsed.value.definition;
  }

  const nextStatus = typeof body.status === "string" ? body.status : null;
  if (nextStatus) {
    if (!["draft", "active", "retired"].includes(nextStatus)) {
      return NextResponse.json({ error: "状態が不正です" }, { status: 400 });
    }
    if (nextStatus === "active") {
      const definition = (patch.definition ?? current.definition) as TemplateRow["definition"];
      const problems = readyForActivation(definition);
      if (problems.length > 0) return NextResponse.json({ error: problems[0], errors: problems }, { status: 400 });
      // 運用中は様式ごとに1版。今の運用中を止めてから入れ替える
      await supabase
        .from("report_image_templates")
        .update({ status: "retired", updated_by: user.driverId })
        .eq("org_id", orgId)
        .eq("template_key", current.template_key)
        .eq("status", "active")
        .neq("id", id);
    }
    patch.status = nextStatus;
  }

  const { data, error } = await supabase
    .from("report_image_templates")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId)
    .select(COLUMNS)
    .single();
  if (error || !data) {
    console.error("[admin/report-image-templates] update error", error);
    return NextResponse.json({ error: "様式を保存できませんでした" }, { status: 400 });
  }
  return NextResponse.json({ template: data });
}

/** 編集中の様式だけ消せる。読み取りに使った版は履歴の参照先なので残す */
export async function DELETE(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_carriers");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? (await resolveOrgId(user.driverId));
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "様式を指定してください" }, { status: 400 });

  const { data: current } = await supabase
    .from("report_image_templates")
    .select("id, status, sample_storage_path")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "様式が見つかりません" }, { status: 404 });
  if (current.status !== "draft") {
    return NextResponse.json({ error: "運用したことがある様式は停止だけできます" }, { status: 400 });
  }

  const { error } = await supabase.from("report_image_templates").delete().eq("id", id).eq("org_id", orgId);
  if (error) return NextResponse.json({ error: "様式を消せませんでした" }, { status: 400 });
  if (current.sample_storage_path) {
    await supabase.storage
      .from("report-image-template-samples")
      .remove([current.sample_storage_path as string])
      .catch(() => undefined);
  }
  return NextResponse.json({ ok: true });
}
