import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 全コースの単価
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const { data, error } = await supabase
    .from("course_rates")
    .select(`
      *,
      courses (id, name, color, sort_order)
    `);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const sorted = (data ?? []).sort((a, b) => {
    const sa = (a.courses as { sort_order?: number })?.sort_order ?? 0;
    const sb = (b.courses as { sort_order?: number })?.sort_order ?? 0;
    return sa - sb;
  });

  return NextResponse.json({ rates: sorted });
}

// PATCH: コース単価を更新
export async function PATCH(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const {
      course_id,
      takuhaibin_revenue,
      takuhaibin_driver_payout,
      nekopos_revenue,
      nekopos_driver_payout,
      fixed_revenue,
      fixed_profit,
    } = body;

    if (!course_id) {
      return NextResponse.json({ error: "course_id is required" }, { status: 400 });
    }

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof takuhaibin_revenue === "number") {
      payload.takuhaibin_revenue = takuhaibin_revenue;
    }
    if (typeof takuhaibin_driver_payout === "number") {
      payload.takuhaibin_driver_payout = takuhaibin_driver_payout;
    }
    if (typeof takuhaibin_revenue === "number" && typeof takuhaibin_driver_payout === "number") {
      payload.takuhaibin_profit = takuhaibin_revenue - takuhaibin_driver_payout;
    }

    if (typeof nekopos_revenue === "number") {
      payload.nekopos_revenue = nekopos_revenue;
    }
    if (typeof nekopos_driver_payout === "number") {
      payload.nekopos_driver_payout = nekopos_driver_payout;
    }
    if (typeof nekopos_revenue === "number" && typeof nekopos_driver_payout === "number") {
      payload.nekopos_profit = nekopos_revenue - nekopos_driver_payout;
    }

    if (typeof fixed_revenue === "number") payload.fixed_revenue = fixed_revenue;
    if (typeof fixed_profit === "number") payload.fixed_profit = fixed_profit;

    const { data, error } = await supabase
      .from("course_rates")
      .update(payload)
      .eq("course_id", course_id)
      .select()
      .single();

    if (error) {
      console.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rate: data });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
