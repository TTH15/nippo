import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { parseQrPayload } from "@/server/vehicleQr/token";

export const dynamic = "force-dynamic";

// POST: 貼付確認（有効化）。車両に貼ったQRを ADMIN が実機スキャンし、
// 「読めること＋正しい車両に紐づくこと」を確認して issued → active に昇格する（§8.2）。
// body: { token | qr } … スキャン文字列（生token or nippo://v/<token>）
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const body = await req.json().catch(() => ({}));
  const token = parseQrPayload(String(body?.token ?? body?.qr ?? ""));
  if (!token) return NextResponse.json({ error: "Invalid QR" }, { status: 400 });

  // token→QR（グローバル解決）。有効化は所有org のみ。
  // tenant-scope-ok: 直後に qr.org_id !== orgId を 403 で弾く（他org のQRは有効化不可）
  const { data: qr } = await supabase
    .from("vehicle_qr")
    .select("id, vehicle_id, org_id, status, version")
    .eq("token", token)
    .maybeSingle();

  if (!qr) return NextResponse.json({ error: "Unknown QR", code: "unknown" }, { status: 404 });
  if (qr.org_id !== orgId) {
    // 他org が発行したQRは有効化できない
    return NextResponse.json({ error: "Forbidden", code: "wrong_org" }, { status: 403 });
  }
  if (qr.status === "revoked") {
    return NextResponse.json({ error: "このQRは失効しています。再発行してください。", code: "revoked" }, { status: 409 });
  }

  // 車両情報（確認画面表示用）
  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("id, manufacturer, brand, number_prefix, number_class, number_hiragana, number_numeric")
    .eq("id", qr.vehicle_id)
    .maybeSingle();

  if (qr.status === "active") {
    // 冪等: 既に有効化済み
    return NextResponse.json({ ok: true, alreadyActive: true, vehicle, version: qr.version });
  }

  // issued → active
  const { error } = await supabase
    .from("vehicle_qr")
    .update({
      status: "active",
      attached_confirmed_at: new Date().toISOString(),
      attached_confirmed_by: user.driverId,
    })
    .eq("id", qr.id)
    .eq("status", "issued"); // 競合ガード

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to activate" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, activated: true, vehicle, version: qr.version });
}
