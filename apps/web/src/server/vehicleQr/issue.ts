// ============================================================
// 車両QR の get-or-create（冪等）。
// 非revoked なQRがあればそれを返し、無ければ issued を1本作成する。
// ★再発行（旧失効＋新規）はしない。再発行は明示操作（route の confirm 経由）。
//   設計: docs/vehicle-session-flow.md §8
// ============================================================

import { supabase } from "@/server/db/client";
import { generateQrToken } from "./token";

export type QrRow = { token: string; version: number; status: string };

/**
 * 車両の有効QRを返す。無ければ issued を作成（冪等＝何度呼んでも再生成しない）。
 * @returns { qr, created } / 失敗時 null
 */
export async function ensureVehicleQr(
  vehicleId: string,
  orgId: string,
  issuedBy?: string,
): Promise<{ qr: QrRow; created: boolean } | null> {
  const { data: current } = await supabase
    .from("vehicle_qr")
    .select("token, version, status")
    .eq("vehicle_id", vehicleId)
    .neq("status", "revoked")
    .maybeSingle();

  if (current) return { qr: current as QrRow, created: false };

  // 次バージョン = 既存（revoked 含む）の最大 +1
  const { data: latest } = await supabase
    .from("vehicle_qr")
    .select("version")
    .eq("vehicle_id", vehicleId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((latest?.version as number | undefined) ?? 0) + 1;

  const token = generateQrToken();
  const { data: created, error } = await supabase
    .from("vehicle_qr")
    .insert({
      vehicle_id: vehicleId,
      org_id: orgId,
      token,
      version: nextVersion,
      status: "issued",
      issued_by: issuedBy ?? null,
    })
    .select("token, version, status")
    .single();

  if (error || !created) {
    // 競合（部分unique）等で入らなかった場合はもう一度読み直す
    const { data: again } = await supabase
      .from("vehicle_qr")
      .select("token, version, status")
      .eq("vehicle_id", vehicleId)
      .neq("status", "revoked")
      .maybeSingle();
    if (again) return { qr: again as QrRow, created: false };
    return null;
  }

  return { qr: created as QrRow, created: true };
}
