import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { generateQrToken, qrPayload } from "@/server/vehicleQr/token";
import { ensureVehicleQr } from "@/server/vehicleQr/issue";

export const dynamic = "force-dynamic";

// 所有org の車両であることを確認しつつ車両を取得（他org車両は 404 で秘匿）。
async function loadOwnedVehicle(vehicleId: string, orgId: string) {
  const { data } = await supabase
    .from("vehicles")
    .select("id, owner_org_id, number_prefix, number_class, number_hiragana, number_numeric")
    .eq("id", vehicleId)
    .eq("owner_org_id", orgId)
    .maybeSingle();
  return data;
}

// GET: この車両の現在のQR（非revoked）を返す。ラベル印刷/状態表示用。
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id: vehicleId } = await params;

  const vehicle = await loadOwnedVehicle(vehicleId, orgId);
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  const { data: qr } = await supabase
    // tenant-scope-ok: loadOwnedVehicle で owner_org_id を確認済みの vehicleId で絞る
    .from("vehicle_qr")
    .select("id, token, version, status, issued_at, attached_confirmed_at")
    .eq("vehicle_id", vehicleId)
    .neq("status", "revoked")
    .maybeSingle();

  return NextResponse.json({
    qr: qr
      ? {
          token: qr.token,
          payload: qrPayload(qr.token as string),
          version: qr.version,
          status: qr.status, // 'issued'(貼付確認待ち) | 'active'(有効)
          issuedAt: qr.issued_at,
          attachedConfirmedAt: qr.attached_confirmed_at,
        }
      : null,
  });
}

// POST: QR発行/再発行。再発行は既存QRを即失効させるため confirm を必須にする（§8.4）。
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requirePermission(req, "can_manage_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id: vehicleId } = await params;

  const vehicle = await loadOwnedVehicle(vehicleId, orgId);
  if (!vehicle) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const confirm = body?.confirm === true;
  const ensure = body?.ensure === true;

  // ensure=get-or-create（冪等）。QRボタン押下/一括DL時に2クリック不要で用意する。
  // 既存があれば再生成せずそのまま返す（再発行は confirm 経路のみ）。
  if (ensure) {
    const r = await ensureVehicleQr(vehicleId, orgId, user.driverId);
    if (!r) return NextResponse.json({ error: "Failed to ensure QR" }, { status: 500 });
    return NextResponse.json({
      qr: {
        token: r.qr.token,
        payload: qrPayload(r.qr.token),
        version: r.qr.version,
        status: r.qr.status,
      },
      reused: !r.created,
    });
  }

  // 既存の有効/未確認トークン
  // tenant-scope-ok: loadOwnedVehicle で owner_org_id を確認済みの vehicleId で絞る
  const { data: current } = await supabase
    .from("vehicle_qr")
    .select("id, version, status")
    .eq("vehicle_id", vehicleId)
    .neq("status", "revoked")
    .maybeSingle();

  // 再発行（既存あり）で未確認なら、失効警告のため confirm を要求（エラーではなく確認待ち）。
  if (current && !confirm) {
    return NextResponse.json({
      requiresConfirm: true,
      message:
        "再発行すると現在のQRは即座に失効します。貼付済みラベルは読めなくなり、新ラベルの印刷→貼付→有効化が必要です。",
      current: { version: current.version, status: current.status },
    });
  }

  // 既存トークンを失効
  if (current) {
    const { error: revErr } = await supabase
      .from("vehicle_qr")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", current.id);
    if (revErr) {
      console.error(revErr);
      return NextResponse.json({ error: "Failed to revoke current QR" }, { status: 500 });
    }
  }

  const nextVersion = (current?.version ?? 0) + 1;
  const token = generateQrToken();

  const { data: created, error } = await supabase
    .from("vehicle_qr")
    .insert({
      vehicle_id: vehicleId,
      org_id: orgId,
      token,
      version: nextVersion,
      status: "issued",
      issued_by: user.driverId,
    })
    .select("token, version, status")
    .single();

  if (error || !created) {
    console.error(error);
    return NextResponse.json({ error: "Failed to issue QR" }, { status: 500 });
  }

  // issued＝印刷可。貼付後に ADMIN が有効化（/api/admin/vehicle-qr/activate）して active になる。
  return NextResponse.json({
    qr: {
      token: created.token,
      payload: qrPayload(created.token as string),
      version: created.version,
      status: created.status,
    },
    revokedPrevious: !!current,
  });
}
