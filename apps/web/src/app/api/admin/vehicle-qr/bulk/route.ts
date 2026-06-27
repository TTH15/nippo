import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { qrPayload } from "@/server/vehicleQr/token";
import { ensureVehicleQr } from "@/server/vehicleQr/issue";

export const dynamic = "force-dynamic";

// POST: 複数車両のQRを一括 get-or-create（冪等）してラベル用データを返す。
// 既存のQRがある車両は再生成しない。所有orgの車両のみ対象（他org/不明IDは無視）。
// body: { vehicleIds: string[] }
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.vehicleIds)
    ? body.vehicleIds.map((x: unknown) => String(x)).filter(Boolean)
    : [];
  if (ids.length === 0) return NextResponse.json({ items: [] });

  // 所有orgの車両だけに絞る（ラベルの車番・車名も取得）
  const { data: vehicles, error } = await supabase
    .from("vehicles")
    .select("id, manufacturer, brand, number_prefix, number_class, number_hiragana, number_numeric")
    .in("id", ids)
    .eq("owner_org_id", orgId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const items: Array<Record<string, unknown>> = [];
  for (const v of vehicles ?? []) {
    const r = await ensureVehicleQr(v.id as string, orgId, user.driverId);
    if (!r) continue; // 作成失敗はスキップ（部分成功を許容）
    items.push({
      vehicleId: v.id,
      token: r.qr.token,
      payload: qrPayload(r.qr.token),
      version: r.qr.version,
      status: r.qr.status,
      manufacturer: v.manufacturer ?? null,
      brand: v.brand ?? null,
      numberPrefix: v.number_prefix ?? null,
      numberClass: v.number_class ?? null,
      numberHiragana: v.number_hiragana ?? null,
      numberNumeric: v.number_numeric ?? null,
    });
  }

  return NextResponse.json({ items });
}
