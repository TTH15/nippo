import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requireAnyPermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { adminMutationError, isDateOnly, isUuid } from "@/server/db/adminResourceScope";

export const dynamic = "force-dynamic";
const todayJst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const user = await requireAnyPermission(req, ["can_view_rewards", "can_manage_rewards"]);
  if (isAuthError(user)) return user;
  const driverId = req.nextUrl.searchParams.get("driver_id");
  const date = req.nextUrl.searchParams.get("date") ?? todayJst();
  if (!isUuid(driverId) || !isDateOnly(date)) return NextResponse.json({ error: "driver_id / date が不正です。" }, { status: 400 });
  const { data, error } = await supabase.rpc("driver_lease_state", { p_org_id: user.orgId, p_driver_id: driverId, p_date: date });
  return error ? adminMutationError(error) : NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_rewards");
  if (isAuthError(user)) return user;
  const body = await req.json().catch(() => null);
  if (!body || !isUuid(body.driver_id) || typeof body.enabled !== "boolean" || !["MONTHLY", "DAILY"].includes(body.mode)
    || !Number.isInteger(body.amount) || body.amount < 0 || body.amount > 2147483647
    || !isDateOnly(body.valid_from) || !body.valid_from.endsWith("-01")) {
    return NextResponse.json({ error: "契約・金額・適用開始月を確認してください。" }, { status: 400 });
  }
  if (typeof body.expected_revision !== "string" || !/^[a-f0-9]{32}$/.test(body.expected_revision)) {
    return NextResponse.json({ error: "最新の契約を読み込んでから保存してください。" }, { status: 428 });
  }
  const { data, error } = await supabase.rpc("save_driver_lease", {
    p_org_id: user.orgId, p_driver_id: body.driver_id, p_enabled: body.enabled, p_mode: body.mode,
    p_amount: body.amount, p_valid_from: body.valid_from, p_expected_revision: body.expected_revision,
  });
  return error ? adminMutationError(error) : NextResponse.json(data);
}
