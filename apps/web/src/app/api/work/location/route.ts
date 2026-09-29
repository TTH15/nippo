import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

type SessionState = { response: NextResponse } | {
  ctx: { orgId: string; user: { driverId: string } };
  session: { vehicle_id: string; started_at: string; status: string; ended_at: string | null };
  tracking: boolean;
};

async function sessionState(req: NextRequest, sessionId: string): Promise<SessionState> {
  const ctx = await requireTenant(req, "DRIVER");
  if (ctx instanceof NextResponse) return { response: ctx };
  const { data: session, error } = await supabase.from("vehicle_sessions")
    .select("id, vehicle_id, purpose, status, started_at, ended_at")
    .eq("id", sessionId).eq("org_id", ctx.orgId).eq("recorded_by", ctx.user.driverId)
    .maybeSingle();
  if (error) return { response: NextResponse.json({ error: "セッションを確認できませんでした" }, { status: 500 }) };
  if (!session || session.purpose !== "work") return { response: NextResponse.json({ error: "対象の稼働がありません" }, { status: 404 }) };
  const { data: parked, error: parkingError } = await supabase.from("vehicle_positions")
    .select("id")
    .eq("org_id", ctx.orgId).eq("vehicle_id", session.vehicle_id)
    .eq("client_key", `${sessionId}:parking`).eq("kind", "parked")
    .maybeSingle();
  if (parkingError) return { response: NextResponse.json({ error: "駐車記録を確認できませんでした" }, { status: 500 }) };
  if (parked) return { ctx, session, tracking: false };
  // 日報画面から後で駐車を登録した場合も停止する。退勤前の別の駐車申告は対象にしない。
  if (session.status === "closed" && session.ended_at) {
    const { data: laterParking, error: laterError } = await supabase.from("vehicle_positions")
      .select("id")
      .eq("org_id", ctx.orgId).eq("vehicle_id", session.vehicle_id)
      .eq("kind", "parked").gte("at", session.ended_at)
      .order("at", { ascending: false }).limit(1).maybeSingle();
    if (laterError) return { response: NextResponse.json({ error: "駐車記録を確認できませんでした" }, { status: 500 }) };
    if (laterParking) return { ctx, session, tracking: false };
  }
  return { ctx, session, tracking: true };
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return NextResponse.json({ error: "sessionId が不正です" }, { status: 400 });
  const state = await sessionState(req, sessionId);
  if ("response" in state) return state.response;
  return NextResponse.json({ tracking: state.tracking });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const points = (Array.isArray(body.positions) ? body.positions : [body]) as Array<{
    lat: number; lng: number; accuracyM: number; at: string;
  }>;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || points.length < 1 || points.length > 500 || points.some((point) => {
    const at = typeof point?.at === "string" ? Date.parse(point.at) : NaN;
    return typeof point?.lat !== "number" || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 ||
      typeof point?.lng !== "number" || !Number.isFinite(point.lng) || Math.abs(point.lng) > 180 ||
      typeof point?.accuracyM !== "number" || !Number.isFinite(point.accuracyM) ||
      point.accuracyM < 0 || point.accuracyM > 200 || !Number.isFinite(at) ||
      at > Date.now() + 30_000 || at < Date.now() - 72 * 3600_000;
  })) {
    return NextResponse.json({ error: "位置情報が不正です" }, { status: 400 });
  }
  const state = await sessionState(req, sessionId);
  if ("response" in state) return state.response;
  if (!state.tracking) return NextResponse.json({ tracking: false });
  const { ctx, session } = state;
  if (points.some((point) => Date.parse(point.at) < Date.parse(session.started_at))) {
    return NextResponse.json({ error: "稼働開始前の位置です" }, { status: 400 });
  }

  const rows = points.map((point) => ({
    org_id: ctx.orgId,
    vehicle_id: session.vehicle_id,
    at: new Date(point.at).toISOString(),
    lat: point.lat, lng: point.lng,
    accuracy_m: point.accuracyM,
    source: "gps",
    kind: "observation",
    recorded_by: ctx.user.driverId,
    client_key: `${sessionId}:gps:${Date.parse(point.at)}`,
  }));
  const { error } = await supabase.from("vehicle_positions").upsert(rows, { // tenant-scope-ok: rowsのorg_idはrequireTenantから得たctx.orgId
    onConflict: "org_id,vehicle_id,client_key", ignoreDuplicates: true,
  });
  if (error) {
    console.error("[work/location] failed to save location", error);
    return NextResponse.json({ error: "位置を保存できませんでした" }, { status: 500 });
  }
  return NextResponse.json({ tracking: true });
}
