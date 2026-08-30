import { describe, expect, it } from "vitest";
import { validateChoiceAnswer } from "./choiceAnswers";

const single = { type: "select" as const, label: "案件内容", required: false, allowOther: true, options: [{ value: "a" }, { value: "other" }] };

describe("その他の自由入力", () => {
  it("選択した場合だけ、任意項目でも自由入力を必須にする", () => {
    expect(validateChoiceAnswer(single, "")).toBeNull();
    expect(validateChoiceAnswer(single, "a")).toBeNull();
    expect(validateChoiceAnswer(single, { selected: [], other: "  " })).toContain("その他の内容");
    expect(validateChoiceAnswer(single, { selected: [], other: "受取人の希望変更" })).toBeNull();
  });
  it("通常のotherというIDと自由入力を区別する", () => {
    expect(validateChoiceAnswer({ ...single, allowOther: false }, "other")).toBeNull();
    expect(validateChoiceAnswer({ ...single, allowOther: false }, { selected: [], other: "入力" })).toContain("選択肢");
  });
  it("単一選択で他の選択肢とその他を同時に指定できない", () => {
    expect(validateChoiceAnswer(single, { selected: ["a"], other: "入力" })).toContain("選択肢");
    expect(validateChoiceAnswer({ ...single, type: "multiselect" }, { selected: ["a"], other: "入力" })).toBeNull();
  });
  it("未知のID・重複・不正な型・文字数超過を拒否する", () => {
    const multiple = { ...single, type: "multiselect" as const };
    expect(validateChoiceAnswer(multiple, { selected: ["missing"], other: "入力" })).toContain("選択肢");
    expect(validateChoiceAnswer(multiple, { selected: ["a", "a"], other: "入力" })).toContain("選択肢");
    expect(validateChoiceAnswer(single, { selected: [], other: 500 })).toContain("選択肢");
    expect(validateChoiceAnswer(single, { selected: [], other: "あ".repeat(501) })).toContain("500文字");
    expect(validateChoiceAnswer(single, { selected: [], other: "あ".repeat(500) })).toBeNull();
  });
});
