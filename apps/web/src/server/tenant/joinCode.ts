// ============================================================
// 参加コード（join_code）生成。
// 会社参加用の招待コード。漏洩時は運営が再生成（承認必須なので漏れても勝手には入れない）。
// 誤読しやすい文字（O/0, I/1/L）を除いた英数字 6 文字。
//   設計: docs/platform-design.md §2-2, §3（識別子モデル）
// ============================================================

export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 曖昧文字を除いた英数字から length 文字の参加コードを生成する。 */
export function generateJoinCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
  }
  return out;
}
