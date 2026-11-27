import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { hasCapabilityCached } from "@/server/auth/permissions";
import { supabase } from "@/server/db/client";
import { adminMutationError, isUuid } from "@/server/db/adminResourceScope";

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_members");
  if (isAuthError(user)) return user;
  const [readLease, editLease, readVehicles, editVehicles, editRequirements] = await Promise.all([
    hasCapabilityCached(user, "can_view_rewards"), hasCapabilityCached(user, "can_manage_rewards"),
    hasCapabilityCached(user, "can_view_vehicles"), hasCapabilityCached(user, "can_manage_vehicles"),
    hasCapabilityCached(user, "can_manage_members"),
  ]);
  const viewLease = readLease || editLease;
  const viewVehicles = readVehicles || editVehicles;
  const { data, error } = await supabase.rpc("driver_settings_overview", { p_org: user.orgId, p_leases: viewLease, p_vehicles: viewVehicles });
  if (error) return NextResponse.json({ error: "ドライバー設定を読み込めませんでした。" }, { status: 500 });
  return NextResponse.json({ ...data, permissions: { viewLease, editLease, viewVehicles, editVehicles, editRequirements } });
}

export async function PATCH(req: NextRequest) {
  const user = await requirePermission(req, "can_view_members");
  if (isAuthError(user)) return user;
  const body = await req.json().catch(() => null);
  if (!body || !isUuid(body.driverId) || !["vehicles","parking"].includes(body.field))
    return NextResponse.json({ error: "設定内容を確認してください。" }, { status: 400 });
  const vehicles = body.field === "vehicles";
  if (!await hasCapabilityCached(user, vehicles ? "can_manage_vehicles" : "can_manage_members"))
    return NextResponse.json({ error: "この設定を変更する権限がありません。" }, { status: 403 });
  const valid = vehicles
    ? [body.value, body.expected].every(ids => Array.isArray(ids) && ids.every(isUuid))
    : typeof body.value === "boolean" && typeof body.expected === "boolean";
  if (!valid) return NextResponse.json({ error: "設定内容を確認してください。" }, { status: 400 });
  const scope = { p_org: user.orgId, p_driver: body.driverId, p_expected: body.expected };
  const { error } = vehicles
    ? await supabase.rpc("set_driver_vehicle_links", { ...scope, p_ids: body.value })
    : await supabase.rpc("set_driver_parking_requirement", { ...scope, p_value: body.value });
  return error ? adminMutationError(error) : NextResponse.json({ ok: true });
}
