import { describe, it, expect } from "vitest";
import { isValidReportDateTime, countAttachmentsByField } from "./report";
import type { AnswerAttachment } from "@/server/reportKinds/fields";

const att = (fieldId: string, path: string): AnswerAttachment =>
  ({ fieldId, path } as AnswerAttachment);

describe("isValidReportDateTime", () => {
  it("正しい形式は true", () => {
    expect(isValidReportDateTime("2026-06-18", "09:30")).toBe(true);
  });
  it("日付/時刻が不正なら false", () => {
    expect(isValidReportDateTime("2026/06/18", "09:30")).toBe(false);
    expect(isValidReportDateTime("2026-06-18", "9:30")).toBe(false);
    expect(isValidReportDateTime("", "")).toBe(false);
  });
});

describe("countAttachmentsByField", () => {
  it("fieldId ごとに件数集計", () => {
    const list = [att("f1", "a"), att("f1", "b"), att("f2", "c")];
    expect(countAttachmentsByField(list)).toEqual({ f1: 2, f2: 1 });
  });
  it("空なら空オブジェクト", () => {
    expect(countAttachmentsByField([])).toEqual({});
  });
});
