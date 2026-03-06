import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 全コース一覧
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;

  const { data: courses, error } = await supabase
    .from("courses")
    .select("*")
    .order("sort_order");

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ courses });
}

// POST: コース追加
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { name, color = "#3b82f6", max_drivers, carrier: carrierRaw, summary_title: summaryTitle } = body as {
      name?: string;
      color?: string;
      max_drivers?: number;
      carrier?: string;
      summary_title?: string | null;
    };

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const capacity =
      typeof max_drivers === "number" && Number.isFinite(max_drivers) && max_drivers >= 1
        ? Math.floor(max_drivers)
        : 1;

    const carrier =
      carrierRaw === "YAMATO" || carrierRaw === "AMAZON" ? carrierRaw : "OTHER";

    // Get max sort order
    const { data: maxData } = await supabase
      .from("courses")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();

    const sortOrder = (maxData?.sort_order ?? 0) + 1;

    const insertRow: Record<string, unknown> = {
      name: name.trim(),
      color,
      sort_order: sortOrder,
      max_drivers: capacity,
      carrier,
    };
    if (summaryTitle !== undefined) {
      insertRow.summary_title = typeof summaryTitle === "string" && summaryTitle.trim() !== "" ? summaryTitle.trim() : null;
    }
    const { data: course, error } = await supabase
      .from("courses")
      .insert(insertRow)
      .select()
      .single();

    if (error) {
      console.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 新規コースにデフォルト単価を設定
    await supabase.from("course_rates").upsert(
      {
        course_id: course.id,
        takuhaibin_revenue: 160,
        takuhaibin_profit: 10,
        takuhaibin_driver_payout: 150,
        nekopos_revenue: 40,
        nekopos_profit: 10,
        nekopos_driver_payout: 30,
        fixed_revenue: 0,
        fixed_profit: 0,
      },
      { onConflict: "course_id" }
    );

    return NextResponse.json({ course });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH: コース並べ替え
export async function PATCH(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { order: orderIds } = body as { order?: string[] };

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json({ error: "order array is required" }, { status: 400 });
    }

    for (let i = 0; i < orderIds.length; i++) {
      const id = orderIds[i];
      if (typeof id !== "string") continue;
      const { error } = await supabase
        .from("courses")
        .update({ sort_order: i })
        .eq("id", id);
      if (error) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
