// 日報「内容」表示の共有型・整形ヘルパ（送信画面の動的フォームに揃える）。

export type ReportContentField = {
  fieldKey: string;
  label: string;
  inputType: string; // INT | TEXT | TIME | BOOL
  groupLabel: string | null;
  valueNum: number | null;
  valueText: string | null;
};

export type ReportContentUnit = {
  unitId: string;
  unitName: string;
  fields: ReportContentField[];
};

/** フィールド値を input_type に応じて表示用文字列へ整形。 */
export function formatFieldValue(f: ReportContentField): string {
  switch (f.inputType) {
    case "INT":
      return (f.valueNum ?? 0).toLocaleString("ja-JP");
    case "BOOL":
      return f.valueText === "true" || f.valueNum === 1 ? "済" : "未";
    case "TIME":
    case "TEXT":
    default:
      return f.valueText ?? (f.valueNum != null ? String(f.valueNum) : "");
  }
}

/** unit 内のフィールドを group_label でグルーピング（出現順を保持）。 */
export function groupFieldsByLabel(
  fields: ReportContentField[],
): { label: string; fields: ReportContentField[] }[] {
  const order: string[] = [];
  const map = new Map<string, ReportContentField[]>();
  for (const f of fields) {
    const key = f.groupLabel ?? "";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(f);
  }
  return order.map((key) => ({ label: key, fields: map.get(key)! }));
}
