import { describe, expect, it } from "vitest";
import { inferFieldType } from "./fieldTypes";

describe("項目名からの形式推定", () => {
  it.each([
    ["支払日", "date"], ["発生日", "date"], ["日数", "number"],
    ["支払金額", "number"], ["参加人数", "number"], ["１投目（ｍ）", "number"],
    ["開始時刻", "time"], ["担当ドライバー", "member"], ["氏名", "short_text"],
    ["支払方法", "select"], ["該当するもの（複数選択可）", "multiselect"],
    ["研修の有無", "bool"], ["対応しましたか？", "bool"], ["再発防止策", "long_text"],
    ["日付の説明", "long_text"], ["電話番号", "short_text"], ["郵便番号", "short_text"],
  ])("%s → %s", (label, type) => expect(inferFieldType(label)).toBe(type));

  it.each(["", "新しい項目", "支払日時", "選手", "自由な質問", "火曜日の担当"]) (
    "曖昧な項目名「%s」には形式を断定しない", label => expect(inferFieldType(label)).toBeUndefined(),
  );
});
