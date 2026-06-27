// ============================================================
// 車両QR トークン生成。
// QR には vehicles.id を直書きせず、推測不可な不透明トークンを埋める（再発行で失効可能・列挙不可）。
// 128bit ランダム → URLセーフ Base64（22文字）。QRペイロードは `nippo://v/<token>`。
//   設計: docs/vehicle-session-flow.md §8.1
// ============================================================

import { randomBytes } from "crypto";

/** 128bit ランダムの URL セーフ 22 文字トークンを生成する。 */
export function generateQrToken(): string {
  // 16 bytes → base64url で 22 文字（パディングなし）
  return randomBytes(16).toString("base64url");
}

/** QR に焼く完全なペイロード文字列。 */
export function qrPayload(token: string): string {
  return `nippo://v/${token}`;
}

/** スキャン文字列（生トークン or `nippo://v/<token>`）から token を取り出す。 */
export function parseQrPayload(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^nippo:\/\/v\/([A-Za-z0-9_-]{16,})$/);
  if (m) return m[1];
  // 生トークンそのまま（URLセーフ Base64 のみ許容）
  if (/^[A-Za-z0-9_-]{16,}$/.test(s)) return s;
  return null;
}
