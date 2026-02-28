import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";
import { todayJST } from "@/lib/date";

export const dynamic = "force-dynamic";

// PUT: 特定月の回収済みマークを更新（collected: true でマーク、日付記録 / false で解除）
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id: vehicleId } = await params;
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicle id required" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { month, collected } = body as { month?: number; collected?: boolean };

    if (typeof month !== "number" || month < 1 || month > 24) {
      return NextResponse.json({ error: "month must be 1-24" }, { status: 400 });
    }
    if (typeof collected !== "boolean") {
      return NextResponse.json({ error: "collected must be boolean" }, { status: 400 });
    }

    if (collected) {
      const collectedDate = todayJST(); // 日本時間の日付（YYYY-MM-DD）
      const { error } = await supabase
        .from("vehicle_recovery_collected")
        .upsert(
          { vehicle_id: vehicleId, month, collected_at: collectedDate },
          { onConflict: "vehicle_id,month" }
        );

      if (error) {
        console.error("[recovery-collected] upsert error", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabase
        .from("vehicle_recovery_collected")
        .delete()
        .eq("vehicle_id", vehicleId)
        .eq("month", month);

      if (error) {
        console.error("[recovery-collected] delete error", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recovery-collected] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
