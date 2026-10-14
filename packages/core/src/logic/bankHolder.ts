/** 口座名義の幅だけを振込出力向けに揃える。保存値・氏名の表記・大小文字は変えない。 */
const fullToHalf = new Map<string, string>();
for (let code = 0xff61; code <= 0xff9f; code++) {
  const half = String.fromCharCode(code);
  fullToHalf.set(half.normalize("NFKC"), half);
}
fullToHalf.set("゛", "ﾞ");
fullToHalf.set("゜", "ﾟ");
export function toHalfWidthBankHolder(value: string): string {
  return Array.from(value, character => {
    const code = character.charCodeAt(0);
    if (code === 0x3000) return " ";
    if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
    if (fullToHalf.has(character)) return fullToHalf.get(character)!;
    if (code >= 0x30a0 && code <= 0x30ff) {
      const parts = Array.from(character.normalize("NFD"));
      if (parts.every(part => fullToHalf.has(part))) return parts.map(part => fullToHalf.get(part)!).join("");
    }
    return character;
  }).join("");
}
/** 非対応の文字を黙って削除せず、出力側へ渡す前に検知する。銀行固有の文字・桁数制限は出力形式側で検査する。 */
export function bankHolderForTransfer(value: string): string {
  const result = toHalfWidthBankHolder(value).trim();
  if (!result || !/^[\x20-\x7e\uff61-\uff9f]+$/.test(result)) throw new Error("口座名義（カナ）を確認してください");
  return result;
}
