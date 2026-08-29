import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission, isAuthError } from "@/server/auth";
import { COURSE_BILLING_VIEW_CAPS, COURSE_BILLING_MANAGE_CAPS } from "@/server/auth/domainCaps";
import { supabase } from "@/server/db/client";
import { resolveOrgId } from "@/server/db/tenant";

export const dynamic = "force-dynamic";

// ============================================================
// コース（＋便）ごとに日報で使う項目の取得/保存。
// 報告項目はキャリア配下の unit に付くが、実際に使う項目はコースで違う
// （Amazon配送は午前/午後/4便の6項目だが、上鳥羽のC1は午前だけ）。
// 行が1件も無いコース/便は「全項目を使う」（後方互換）。
// ============================================================

type Selection = { cycle_no?: number; unit_id: string; field_key: string };

export async function GET(req: NextRequest) {
  const user = await requireAnyPermission(req, COURSE_BILLING_VIEW_CAPS);
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const courseId = req.nextUrl.searchParams.get("course_id") ?? "";
  if (!courseId) return NextResponse.json({ error: "course_id が必要です" }, { status: 400 });

  const { data: course } = await supabase
    .from("courses").select("id, carrier_id, uses_cycles").eq("id", courseId).eq("org_id", orgId).maybeSingle();
  if (!course) return NextResponse.json({ error: "コースが見つかりません" }, { status: 404 });

  const carrierId = (course as any).carrier_id as string | null;
  const [{ data: units }, { data: cycles }, { data: selected }] = await Promise.all([
    carrierId
      ? supabase.from("units").select("id, name, sort_order").eq("carrier_id", carrierId).eq("active", true).order("sort_order")
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("course_cycles").select("cycle_no, label, active").eq("course_id", courseId).order("cycle_no"),
    supabase.from("course_report_fields").select("cycle_no, unit_id, field_key").eq("course_id", courseId),
  ]);
  const unitIds = (units ?? []).map((u: any) => u.id);
  const { data: fields } = unitIds.length
    ? await supabase.from("unit_fields")
        .select("unit_id, field_key, label, group_label, input_type, sort_order").in("unit_id", unitIds).order("sort_order")
    : { data: [] as any[] };

  return NextResponse.json({
    usesCycles: !!(course as any).uses_cycles,
    cycles: (cycles ?? []).filter((c: any) => c.active).map((c: any) => ({ cycleNo: Number(c.cycle_no), label: c.label ?? null })),
    units: (units ?? []).map((u: any) => ({
      id: u.id,
      name: u.name,
      fields: (fields ?? []).filter((f: any) => f.unit_id === u.id).map((f: any) => ({
        fieldKey: f.field_key,
        label: f.label ?? f.field_key,
        groupLabel: f.group_label ?? null,
        inputType: f.input_type ?? "INT",
      })),
    })),
    // 空配列なら「全項目を使う」（絞り込み未設定）
    selected: (selected ?? []).map((s: any) => ({
      cycleNo: Number(s.cycle_no) || 0, unitId: s.unit_id, fieldKey: s.field_key,
    })),
  });
}

export async function PUT(req: NextRequest) {
  const user = await requireAnyPermission(req, COURSE_BILLING_MANAGE_CAPS);
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const body = await req.json().catch(() => ({}));
  const courseId = typeof body.course_id === "string" ? body.course_id : "";
  if (!courseId) return NextResponse.json({ error: "course_id が必要です" }, { status: 400 });
  const { data: course } = await supabase
    .from("courses").select("id").eq("id", courseId).eq("org_id", orgId).maybeSingle();
  if (!course) return NextResponse.json({ error: "コースが見つかりません" }, { status: 404 });

  const selections: Selection[] = Array.isArray(body.selected) ? body.selected : [];
  const rows = selections
    .filter((s) => typeof s.unit_id === "string" && typeof s.field_key === "string")
    .map((s) => ({
      course_id: courseId,
      cycle_no: Number.isInteger(s.cycle_no) && Number(s.cycle_no) >= 0 ? Number(s.cycle_no) : 0,
      unit_id: s.unit_id,
      field_key: s.field_key,
    }));

  // 総入れ替え。空で保存＝絞り込み解除（全項目を使う）
  const { error: delErr } = await supabase.from("course_report_fields").delete().eq("course_id", courseId);
  if (delErr) {
    console.error(delErr);
    return NextResponse.json({ error: "入力項目の保存に失敗しました" }, { status: 500 });
  }
  if (rows.length) {
    const { error } = await supabase.from("course_report_fields").insert(rows);
    if (error) {
      console.error(error);
      return NextResponse.json({ error: "入力項目の保存に失敗しました" }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, saved: rows.length });
}
