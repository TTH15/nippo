import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { normalizeCapability } from "@/server/reportKinds/config";
import { normalizeFields, validateKindFields, type VehicleMode } from "@/server/reportKinds/fields";

export const dynamic = "force-dynamic";

function normVehicleMode(raw: unknown): VehicleMode {
  return raw === "optional" || raw === "none" ? raw : "required";
}

// PATCH: 種別を更新（key は不変＝既存報告との対応を保つ）。
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_report_kinds");
  if (isAuthError(user)) return user;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("label" in body) {
    const label = String(body.label ?? "").trim();
    if (!label) return NextResponse.json({ error: "表示名は必須です。" }, { status: 400 });
    updates.label = label;
  }
  if ("sortOrder" in body && Number.isFinite(Number(body.sortOrder))) updates.sort_order = Math.trunc(Number(body.sortOrder));
  if ("isActive" in body) updates.is_active = body.isActive === true;
  if ("capability" in body) updates.capability = normalizeCapability(body.capability);
  if ("vehicleMode" in body) updates.vehicle_mode = normVehicleMode(body.vehicleMode);
  if ("fields" in body) updates.fields = normalizeFields(body.fields);

  // 現在値（不足分の補完用）。
  const { data: current, error: curErr } = await supabase
    .from("report_kinds")
    .select("capability, vehicle_mode, fields")
    .eq("id", id)
    .maybeSingle();
  if (curErr || !current) return NextResponse.json({ error: "種別が見つかりません。" }, { status: 404 });

  // fields/vehicle_mode/capability の整合性チェック（更新後の値で判定）。
  const nextCap = (updates.capability as "none" | "oil_mileage" | "expense") ?? normalizeCapability(current.capability);
  const nextVeh = (updates.vehicle_mode as VehicleMode) ?? normVehicleMode(current.vehicle_mode);
  const nextFields = "fields" in updates ? (updates.fields as ReturnType<typeof normalizeFields>) : normalizeFields(current.fields);
  if ("fields" in updates || "vehicleMode" in body || "capability" in body) {
    const check = validateKindFields(nextFields, nextVeh, nextCap);
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });
  }

  // 後方互換: uses_vehicle を vehicle_mode から同期。
  if ("vehicleMode" in body) updates.uses_vehicle = nextVeh !== "none";

  const { data, error } = await supabase.from("report_kinds").update(updates).eq("id", id).select("*").maybeSingle();
  if (error) {
    console.error("[admin/report-kinds/:id] update error", error);
    return NextResponse.json({ error: "更新に失敗しました。" }, { status: 500 });
  }
  return NextResponse.json({ kind: data });
}

// DELETE: 種別を削除。既存の報告データは text の report_kind を保持（ラベルはキー表示にフォールバック）。
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_report_kinds");
  if (isAuthError(user)) return user;
  const { id } = await params;
  const { error } = await supabase.from("report_kinds").delete().eq("id", id);
  if (error) {
    console.error("[admin/report-kinds/:id] delete error", error);
    return NextResponse.json({ error: "削除に失敗しました。" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
