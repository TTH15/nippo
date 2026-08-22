import { describe, expect, it } from "vitest";
import { validateCourseSettings } from "./courseSettingsValidation";

const validInput = {
  name: "豊中 Amazon",
  maxDrivers: "4",
  usesCycles: true,
  cycleCount: 2,
};

describe("validateCourseSettings", () => {
  it("有効なコース設定を受け入れる", () => {
    expect(validateCourseSettings(validInput)).toEqual([]);
  });

  it("空のコース名を指摘する", () => {
    expect(validateCourseSettings({ ...validInput, name: "　 " })).toContainEqual({
      field: "name",
      message: "コース名を入力してください",
    });
  });

  it("人数の空欄と0人を区別して指摘する", () => {
    expect(validateCourseSettings({ ...validInput, maxDrivers: "" })).toContainEqual({
      field: "maxDrivers",
      message: "いつもの1日の人数を入力してください",
    });
    expect(validateCourseSettings({ ...validInput, maxDrivers: "0" })).toContainEqual({
      field: "maxDrivers",
      message: "いつもの1日の人数は1人以上で入力してください",
    });
  });

  it("サイクル使用時だけ0件を指摘する", () => {
    expect(validateCourseSettings({ ...validInput, cycleCount: 0 })).toContainEqual({
      field: "cycles",
      message: "サイクルを1つ以上追加してください",
    });
    expect(validateCourseSettings({ ...validInput, usesCycles: false, cycleCount: 0 })).toEqual([]);
  });
});
