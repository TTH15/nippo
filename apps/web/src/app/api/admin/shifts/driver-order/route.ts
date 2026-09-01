import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { adminMutationError, isUuid } from "@/server/db/adminResourceScope";

export const dynamic = "force-dynamic";

/** シフト表のドライバー行を、組織内の共通順として保存する。 */
export async function PATCH(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const rawOrder: unknown = body?.order;
    if (!Array.isArray(rawOrder) || rawOrder.length === 0 || rawOrder.length > 1_000 || rawOrder.some((id: unknown) => typeof id !== "string" || !isUuid(id))) {
      return NextResponse.json({ error: "有効な並び順を指定してください。" }, { status: 400 });
    }
    const order = rawOrder as string[];
    if (new Set(order).size !== order.length) {
      return NextResponse.json({ error: "同じドライバーが重複しています。" }, { status: 400 });
    }

    const orgId = user.orgId ?? await resolveOrgId(user.driverId);
    const { data: scopedRows, error: scopeError } = await supabase
      .from("drivers")
      .select("id")
      .eq("org_id", orgId)
      .eq("works_as_driver", true)
      .eq("status", "active")
      .in("id", order);
    if (scopeError) throw scopeError;
    if ((scopedRows ?? []).length !== order.length) {
      return NextResponse.json({ error: "対象のドライバーが見つかりません。" }, { status: 404 });
    }

    const { error } = await supabase.rpc("reorder_shift_drivers", {
      p_org_id: orgId,
      p_driver_ids: order,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return adminMutationError(error);
  }
}
