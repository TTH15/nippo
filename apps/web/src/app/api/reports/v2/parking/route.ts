import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { prepareParkingReport, writeParkingReport } from "@/server/reports/parking";
import { hasParkingPosition, parseConfirmedParking, reportParkingPositionKey, readParkingReceipt } from "@/server/reports/postSubmitParking";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
const readKey = (one: unknown): one is string => typeof one === "string" && one.length > 0 && one.length <= 100;

export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const key = req.nextUrl.searchParams.get("key");
  if (!readKey(key)) return json({ error: "日報を確認してください" }, 400);
  const ctx = { orgId: await resolveOrgId(user.driverId), driverId: user.driverId };
  try {
    const snap = await readParkingReceipt(supabase, ctx, key);
    if (!snap) return json({ stage: "not_found" });
    const complete = await hasParkingPosition(supabase, ctx, snap, key);
    return json({ ...snap, stage: complete ? "complete" : snap.stage });
  } catch {
    return json({ error: "駐車場所の記録を確認できませんでした" }, 503);
  }
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "DRIVER");
  if (isAuthError(user)) return user;
  const body = await req.json().catch(() => null);
  const key = body?.receiptKey;
  if (!readKey(key)) return json({ error: "日報を確認してください" }, 400);
  const ctx = { orgId: await resolveOrgId(user.driverId), driverId: user.driverId };
  try {
    const snap = await readParkingReceipt(supabase, ctx, key);
    if (!snap) return json({ error: "保存済みの日報が見つかりません" }, 404);
    if (snap.stage !== "required") return json({ error: "この日報には駐車場所の記録は不要です" }, 409);
    if (await hasParkingPosition(supabase, ctx, snap, key)) return json({ parkingSaved: true });
    const parking = parseConfirmedParking(body.parking, snap, reportParkingPositionKey(ctx, key));
    if (!parking.ok) return json({ error: parking.error }, 400);
    const prepared = await prepareParkingReport(supabase, parking.value, ctxWithDate(ctx, snap.reportDate), { requireMap: true });
    const result = await writeParkingReport(supabase, prepared, { once: true });
    if (!result.saved) throw new Error("駐車場所を記録できませんでした");
    return json({ parkingSaved: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "駐車場所を記録できませんでした" }, 409);
  }
}

const ctxWithDate = (ctx: { orgId: string; driverId: string }, reportDate: string) => ({ ...ctx, reportDate });
