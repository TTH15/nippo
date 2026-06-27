import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// POST: 月に紐づく手動回収行を追加
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_vehicles");
  if (isAuthError(user)) return user;

  const { id: vehicleId } = await params;
  if (!vehicleId) return NextResponse.json({ error: "vehicle id required" }, { status: 400 });

  let body: { ym?: string; lease?: number; insurance?: number; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ymRaw = typeof body.ym === "string" ? body.ym : "";
  const ym = /^\d{4}-\d{2}$/.test(ymRaw)
    ? `${ymRaw}-01`
    : /^\d{4}-\d{2}-\d{2}$/.test(ymRaw)
      ? `${ymRaw.slice(0, 7)}-01`
      : "";
  if (!ym) return NextResponse.json({ error: "対象月(ym)が不正です" }, { status: 400 });

  const { data, error } = await supabase
    .from("vehicle_recovery_entries")
    .insert({
      vehicle_id: vehicleId,
      ym,
      lease: Math.max(0, Math.trunc(Number(body.lease) || 0)),
      insurance: Math.max(0, Math.trunc(Number(body.insurance) || 0)),
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    })
    .select("id, vehicle_id, ym, lease, insurance, note")
    .single();

  if (error) {
    console.error("[recovery-entries] POST error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ entry: data });
}

// DELETE: ?entry_id= で手動回収行を削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_vehicles");
  if (isAuthError(user)) return user;

  const { id: vehicleId } = await params;
  const entryId = req.nextUrl.searchParams.get("entry_id");
  if (!vehicleId || !entryId) {
    return NextResponse.json({ error: "entry_id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("vehicle_recovery_entries")
    .delete()
    .eq("id", entryId)
    .eq("vehicle_id", vehicleId);

  if (error) {
    console.error("[recovery-entries] DELETE error", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
