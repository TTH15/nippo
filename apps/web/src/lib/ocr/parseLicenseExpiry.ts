// ============================================================
// 免許証 OCR テキストから「有効期限」を抽出する純関数（テスト対象）。
// 対応表記:
//   - 西暦: 「2028年08月22日まで有効」（2019年3月以降の交付は西暦併記）
//   - 和暦: 「令和10年08月22日まで有効」「平成30年…」「令和元年…」
// 免許証には 交付日・生年月日 など他の日付も写るため、
//   ①「まで」が直後に続く候補を最優先 ②同点なら最も未来の日付
// で有効期限らしい1件を選ぶ。全角数字・空白混入（OCR ゆらぎ）も吸収する。
// ============================================================

const toHalfWidth = (s: string) =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

type Candidate = { y: number; m: number; d: number; hasMade: boolean };

export function parseLicenseExpiry(
  raw: string,
  baseYear = new Date().getFullYear(),
): string | null {
  // OCR は桁間に空白や改行を挟みがちなので、全部詰めてから探す。
  const text = toHalfWidth(raw).replace(/[\s　]/g, "");
  const candidates: Candidate[] = [];

  const push = (y: number, m: number, d: number, tail: string) => {
    if (y < baseYear - 1 || y > baseYear + 11) return; // 生年月日・誤読の排除
    if (m < 1 || m > 12) return;
    if (d < 1 || d > daysInMonth(y, m)) return;
    candidates.push({ y, m, d, hasMade: tail.startsWith("まで") });
  };

  // 西暦表記
  for (const mt of text.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) {
    push(Number(mt[1]), Number(mt[2]), Number(mt[3]), text.slice((mt.index ?? 0) + mt[0].length));
  }
  // 和暦表記（令和=2018+n / 平成=1988+n・元年対応）
  for (const mt of text.matchAll(/(令和|平成)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/g)) {
    const n = mt[2] === "元" ? 1 : Number(mt[2]);
    const y = mt[1] === "令和" ? 2018 + n : 1988 + n;
    push(y, Number(mt[3]), Number(mt[4]), text.slice((mt.index ?? 0) + mt[0].length));
  }

  if (candidates.length === 0) return null;

  // 「まで」付き最優先 → より未来の日付。
  candidates.sort((a, b) => {
    if (a.hasMade !== b.hasMade) return a.hasMade ? -1 : 1;
    return b.y * 10000 + b.m * 100 + b.d - (a.y * 10000 + a.m * 100 + a.d);
  });
  const best = candidates[0];
  return `${best.y}-${String(best.m).padStart(2, "0")}-${String(best.d).padStart(2, "0")}`;
}
