// 電話番号の E.164 正規化（当面 日本前提）。
// 入力例 "090-1234-5678" / "09012345678" / "+819012345678" → "+819012345678"

/** 日本の電話番号を E.164（+81…）へ正規化する。判別不能なら null。 */
export function toE164JP(raw: string): string | null {
  if (!raw) return null;
  let s = raw.replace(/[^\d+]/g, "");
  if (s.startsWith("+")) {
    // 既に国番号付き。数字のみ残して + を戻す。
    const digits = s.slice(1).replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
  s = s.replace(/\D/g, "");
  if (s.startsWith("81")) return `+${s}`;
  if (s.startsWith("0")) return `+81${s.slice(1)}`;
  // 0 始まりでない国内番号は判別不能
  return null;
}
