// ============================================================
// 車両QR トークンの解決と認可（テナント横断）。
// token→vehicle は org 非依存で解決し、認可は別レイヤ＝
//   「所有org」 or 「その日その車を借りている借用org（vehicle_loans.borrower_org_id）」。
// スキャン結果は必ず理由付きコードで返す（無言失敗を作らない）。
//   設計: docs/vehicle-session-flow.md §8.1,§8.3,§13
// ============================================================

import { supabase } from "@/server/db/client";

// §8.3 のスキャンエラー全種
export type QrResolveCode =
  | "ok" // active＋認可OK
  | "revoked" // 再発行で失効した旧ラベル
  | "pending_attach" // issued（ADMIN貼付確認待ち）
  | "not_authorized" // 所有orgでも有効貸与の借用orgでもない
  | "unknown" // 不明/破損/偽造トークン・無効車両
  | "vehicle_inactive"; // 廃車/無効化車両

// 認可だけのコード（token を介さない plate_ocr / manual 経路で使う）
export type VehicleAuthCode = "ok" | "not_authorized" | "unknown" | "vehicle_inactive";

export type ResolvedVehicle = {
  id: string;
  ownerOrgId: string | null;
  isDisposed: boolean;
  // 表示用のナンバー（プレートOCR照合・確認画面用）
  numberPrefix: string | null;
  numberClass: string | null;
  numberHiragana: string | null;
  numberNumeric: string | null;
};

export type VehicleAuthResult = {
  code: VehicleAuthCode;
  vehicle?: ResolvedVehicle;
  usage?: "owner" | "borrower";
};

export type QrResolveResult = {
  code: QrResolveCode;
  qr?: { id: string; status: string; version: number };
  vehicle?: ResolvedVehicle;
  usage?: "owner" | "borrower";
};

function mapVehicle(v: Record<string, unknown>): ResolvedVehicle {
  return {
    id: v.id as string,
    ownerOrgId: (v.owner_org_id as string | null) ?? null,
    isDisposed: !!v.is_disposed,
    numberPrefix: (v.number_prefix as string | null) ?? null,
    numberClass: (v.number_class as string | null) ?? null,
    numberHiragana: (v.number_hiragana as string | null) ?? null,
    numberNumeric: (v.number_numeric as string | null) ?? null,
  };
}

const VEHICLE_COLS =
  "id, owner_org_id, is_disposed, number_prefix, number_class, number_hiragana, number_numeric";

/**
 * 車両ID を requesterOrgId の文脈で認可する（所有org or 当日の借用org）。
 * plate_ocr / manual 経路（token を介さず車両を直接指定）からも使う。
 * @param onDate 借用判定の基準日（YYYY-MM-DD, JST）。
 */
export async function authorizeVehicleForOrg(
  vehicleId: string,
  requesterOrgId: string,
  onDate: string,
): Promise<VehicleAuthResult> {
  const { data: v } = await supabase
    .from("vehicles")
    .select(VEHICLE_COLS)
    .eq("id", vehicleId)
    .maybeSingle();

  if (!v) return { code: "unknown" };
  const vehicle = mapVehicle(v);
  if (vehicle.isDisposed) return { code: "vehicle_inactive", vehicle };

  // 所有org なら即OK
  if (vehicle.ownerOrgId && vehicle.ownerOrgId === requesterOrgId) {
    return { code: "ok", vehicle, usage: "owner" };
  }

  // その日その車を借りている借用org なら OK
  const { data: loan } = await supabase
    .from("vehicle_loans")
    .select("id")
    .eq("vehicle_id", vehicle.id)
    .eq("loan_date", onDate)
    .eq("borrower_org_id", requesterOrgId)
    .maybeSingle();

  if (loan) return { code: "ok", vehicle, usage: "borrower" };
  return { code: "not_authorized", vehicle };
}

/**
 * トークンから車両を解決し、requesterOrgId の認可可否まで判定する。
 * @param onDate 借用判定の基準日（YYYY-MM-DD, JST）。通常は当日。
 */
export async function resolveVehicleByToken(
  token: string,
  requesterOrgId: string,
  onDate: string,
): Promise<QrResolveResult> {
  // token→QR（グローバル解決：org で絞らない）
  const { data: qr } = await supabase
    .from("vehicle_qr")
    // tenant-scope-ok: 貸与車を借用org がスキャンする経路があるため token はグローバル解決し、
    //                  車両の利用可否は直後の authorizeVehicleForOrg(requesterOrgId) で判定する
    .select("id, vehicle_id, status, version")
    .eq("token", token)
    .maybeSingle();

  if (!qr) return { code: "unknown" };
  const qrInfo = { id: qr.id as string, status: qr.status as string, version: qr.version as number };

  if (qr.status === "revoked") return { code: "revoked", qr: qrInfo };
  if (qr.status === "issued") return { code: "pending_attach", qr: qrInfo };

  // status === 'active' → 車両の認可へ
  const auth = await authorizeVehicleForOrg(qr.vehicle_id as string, requesterOrgId, onDate);
  return { code: auth.code, qr: qrInfo, vehicle: auth.vehicle, usage: auth.usage };
}

// ドライバー向けのエラー文言（§8.3）。ok のときは null。
export function qrCodeMessage(code: QrResolveCode | VehicleAuthCode): string | null {
  switch (code) {
    case "ok":
      return null;
    case "revoked":
      return "このQRは新しいものに貼り替えられています。新しいラベルを使うか、運営に連絡してください。";
    case "pending_attach":
      return "このQRはまだ有効化されていません（貼付確認待ち）。ナンバープレートで打刻するか、運営に連絡してください。";
    case "not_authorized":
      return "この車両は利用できません（貸与の登録が必要かもしれません）。運営に連絡してください。";
    case "unknown":
      return "読み取れませんでした。ナンバープレートで打刻できます。";
    case "vehicle_inactive":
      return "この車両は現在使えません。";
  }
}
