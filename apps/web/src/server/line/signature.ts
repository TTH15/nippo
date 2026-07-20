// ============================================================
// LINE webhook の署名検証。
// webhook は当プロジェクトで唯一 JWT 認証（requireAuth）を通らないルートのため、
// 「x-line-signature が channel secret の HMAC-SHA256 と一致すること」が認証そのもの。
// 生ボディ（パース前の文字列）に対して計算する必要がある点に注意。
//   env: LINE_CHANNEL_SECRET
// ============================================================
import crypto from "node:crypto";

/**
 * 署名を検証する。タイミング攻撃を避けるため timingSafeEqual で比較する。
 * secret 未設定・署名欠落・長さ不一致はすべて false（default-deny）。
 */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
