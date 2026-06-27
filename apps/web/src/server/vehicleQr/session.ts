// ============================================================
// 出退勤打刻の共通ロジック: スキャン対象（車両）の解決と認可。
// 打刻手段（qr / plate_ocr / manual）を吸収し、認可済み vehicleId を返す。
//   設計: docs/vehicle-session-flow.md §2,§3,§8.5
// ============================================================

import { parseQrPayload } from "./token";
import { resolveVehicleByToken, authorizeVehicleForOrg, qrCodeMessage } from "./resolve";

export type ScanMethod = "qr" | "plate_ocr" | "manual";

export type ScanTarget = {
  ok: boolean;
  code: string; // ok | revoked | pending_attach | not_authorized | unknown | vehicle_inactive
  message: string | null;
  method: ScanMethod;
  vehicleId: string | null;
  usage: "owner" | "borrower" | null;
};

/** body の method に応じて車両を特定し、requesterOrg の認可可否まで判定する。 */
export async function resolveScanTarget(
  body: { method?: unknown; token?: unknown; qr?: unknown; vehicleId?: unknown },
  orgId: string,
  onDate: string,
): Promise<ScanTarget> {
  const method: ScanMethod =
    body?.method === "plate_ocr" || body?.method === "manual" ? body.method : "qr";

  if (method === "qr") {
    const token = parseQrPayload(String(body?.token ?? body?.qr ?? ""));
    if (!token) {
      return { ok: false, code: "unknown", message: qrCodeMessage("unknown"), method, vehicleId: null, usage: null };
    }
    const r = await resolveVehicleByToken(token, orgId, onDate);
    return {
      ok: r.code === "ok",
      code: r.code,
      message: qrCodeMessage(r.code),
      method,
      vehicleId: r.vehicle?.id ?? null,
      usage: r.usage ?? null,
    };
  }

  // plate_ocr / manual: 車両を直接指定（プレートOCRの照合結果 or 手選択）
  const vehicleId = body?.vehicleId ? String(body.vehicleId) : null;
  if (!vehicleId) {
    return { ok: false, code: "unknown", message: "車両が指定されていません。", method, vehicleId: null, usage: null };
  }
  const a = await authorizeVehicleForOrg(vehicleId, orgId, onDate);
  return {
    ok: a.code === "ok",
    code: a.code,
    message: qrCodeMessage(a.code),
    method,
    vehicleId: a.vehicle?.id ?? null,
    usage: a.usage ?? null,
  };
}

/** 数値（メーター等）の安全パース。無効値は null。 */
export function parseIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
}

/** GPS 状態の正規化（captured/denied/unavailable 以外は null）。 */
export function normGpsStatus(v: unknown): string | null {
  return v === "captured" || v === "denied" || v === "unavailable" ? v : null;
}
