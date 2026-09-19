import { describe, expect, it } from "vitest";
import { dateLabel, stateLabel } from "./ShiftStaffingExceptions";

describe("dateLabel", () => {
  it("ハイフン表記を出さず M月D日（曜）にする", () => {
    expect(dateLabel("2026-09-21")).toBe("9月21日（月）");
    expect(dateLabel("2026-10-04")).toBe("10月4日（日）");
  });

  it("読めない値はそのまま返す", () => {
    expect(dateLabel("なにか")).toBe("なにか");
  });
});

describe("stateLabel", () => {
  it("休み・未確定・人数を区別する", () => {
    expect(stateLabel("closed", null)).toBe("休み");
    expect(stateLabel("undecided", null)).toBe("人数未確定");
    expect(stateLabel("working", 3)).toBe("3人");
  });

  it("0人も人数として出す（未確定と混ぜない）", () => {
    expect(stateLabel("working", 0)).toBe("0人");
  });
});
