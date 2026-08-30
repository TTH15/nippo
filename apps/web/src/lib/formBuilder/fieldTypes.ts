export const FIELD_TYPE_LABELS = {
  short_text: "短い文章", long_text: "長い文章", number: "数値・金額",
  select: "単一選択", multiselect: "複数選択", date: "日付", time: "時刻",
  bool: "はい・いいえ", member: "メンバー",
} as const;

export type FormFieldType = keyof typeof FIELD_TYPE_LABELS;

export const FIELD_TYPE_DESCRIPTIONS: Record<FormFieldType, string> = {
  short_text: "氏名・件名など、1行の回答",
  long_text: "経緯・備考など、複数行の回答",
  number: "金額・人数・数量など",
  select: "選択肢から1つ選ぶ",
  multiselect: "選択肢から複数選ぶ",
  date: "カレンダーから日付を選ぶ",
  time: "時・分を入力する",
  bool: "はい・いいえで答える",
  member: "組織のメンバーから選ぶ",
};

/** 確度の高い項目名だけを推定する。外部送信・AI呼び出しは行わない。 */
export function inferFieldType(label: string): FormFieldType | undefined {
  const name = label.normalize("NFKC").replace(/\s+/g, "").replace(/[?？:：]$/, "");
  // 番号・コードは先頭ゼロなどを保持する文字列。「日数」は日付ではない。
  if (/(番号|コード|ID|id|電話|郵便)/.test(name)) return "short_text";
  if (/(説明|理由|経緯|備考|詳細|再発防止策|報告内容|対応内容|連絡事項|引き継ぎ事項)$/.test(name)) return "long_text";
  if (/^(氏名|名前|件名|タイトル|場所|住所)$/.test(name)) return "short_text";
  if (/(金額|料金|単価|費用|人数|個数|件数|数量|日数|走行距離|走行距離\(km\)|距離\(km\))$/.test(name) || /\((円|人|個|件|km|kg|m)\)$/.test(name)) return "number";
  if (/(開始時刻|終了時刻|集合時刻|訪問時刻|到着時刻|出発時刻|支払時刻|時刻)$/.test(name)) return "time";
  if (/^(日付|発生日|報告日|記録日|支払日|稼働日|勤務日|対応日|解決日|開始日|終了日|提出日|生年月日|訪問日|入社日)$/.test(name)) return "date";
  if (/^(報告者|担当者|対象者|対象ドライバー|担当ドライバー|対応担当者|確認者)$/.test(name)) return "member";
  if (/^(支払方法|案件種別|報告種別|種別|区分|カテゴリ|カテゴリー)$/.test(name)) return "select";
  if (/(複数選択|複数回答)(可|可能)?\)?$/.test(name)) return "multiselect";
  if (/(有無|済みですか|しましたか|必要ですか)$/.test(name)) return "bool";
  return undefined;
}
