import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { loadReportKinds, normalizeCapability } from "@/server/reportKinds/config";
import { normalizeFields, validateKindFields, type VehicleMode } from "@/server/reportKinds/fields";

export const dynamic = "force-dynamic";

// GET: 全種別（管理画面の設定用）。
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_org_settings");
  if (isAuthError(user)) return user;
  const kinds = await loadReportKinds(supabase);
  return NextResponse.json({ kinds });
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;

function normVehicleMode(raw: unknown): VehicleMode {
  return raw === "optional" || raw === "none" ? raw : "required";
}

// POST: 種別を追加（フォームビルダー: fields/vehicleMode）。
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_report_kinds");
  if (isAuthError(user)) return user;

  const body = await req.json().catch(() => ({}));
  const key = String(body.key ?? "").trim().toLowerCase();
  const label = String(body.label ?? "").trim();
  if (!KEY_RE.test(key)) {
    return NextResponse.json({ error: "キーは英小文字・数字・アンダースコアで、英字始まりにしてください。" }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: "表示名は必須です。" }, { status: 400 });
  }

  const capability = normalizeCapability(body.capability);
  const vehicleMode = normVehicleMode(body.vehicleMode);
  const fields = normalizeFields(body.fields);
  const check = validateKindFields(fields, vehicleMode, capability);
  if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });

  const row = {
    key,
    label,
    sort_order: Number.isFinite(Number(body.sortOrder)) ? Math.trunc(Number(body.sortOrder)) : 999,
    is_active: body.isActive !== false,
    capability,
    fields,
    vehicle_mode: vehicleMode,
    // 後方互換の uses_* は fields から最小限導出（fromRow は fields を優先するため表示には未使用）。
    uses_vehicle: vehicleMode !== "none",
  };

  const { data, error } = await supabase.from("report_kinds").insert(row).select("*").maybeSingle();
  if (error) {
    console.error("[admin/report-kinds] insert error", error);
    const dup = error.code === "23505";
    return NextResponse.json(
      { error: dup ? "そのキーは既に使われています。" : "保存に失敗しました（migration 068/072 未適用の可能性）。" },
      { status: dup ? 400 : 500 },
    );
  }
  return NextResponse.json({ kind: data });
}
