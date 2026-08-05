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

/**
 * DB の identities.phone を引くときの表記ゆれ候補を返す。
 * 招待リンク経由（/api/join）は E.164 で保存する一方、運営が管理画面から作った行は
 * "08012345678" のような国内表記のまま保存されている（2026-08-05 に本番で確認）。
 * 正規化だけでは既存行を拾えないため、照合側で両方の表記を見る。
 */
export function phoneLookupVariants(raw: string): string[] {
  const e164 = toE164JP(raw);
  if (!e164) return [];
  const local = e164.startsWith("+81") ? `0${e164.slice(3)}` : null;
  return local ? [e164, local] : [e164];
}
