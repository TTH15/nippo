import { describe, expect, it } from "vitest";
import { isActiveInMonth, isMemberInPeriod } from "./activePeriod";

describe("isActiveInMonth", () => {
  const d = { active_from_month: "2026-02", active_until_month: "2026-08" };

  it("開始月と終了月の間なら稼働中（境界の月も含む）", () => {
    expect(isActiveInMonth(d, "2026-02")).toBe(true);
    expect(isActiveInMonth(d, "2026-05")).toBe(true);
    expect(isActiveInMonth(d, "2026-08")).toBe(true);
  });

  it("開始前・終了後は稼働していない", () => {
    expect(isActiveInMonth(d, "2026-01")).toBe(false);
    expect(isActiveInMonth(d, "2026-09")).toBe(false);
    expect(isActiveInMonth(d, "2025-12")).toBe(false);
  });

  it("年をまたいでも月の文字列比較で正しい", () => {
    expect(isActiveInMonth({ active_from_month: "2025-11", active_until_month: null }, "2026-01")).toBe(true);
    expect(isActiveInMonth({ active_from_month: "2026-01", active_until_month: null }, "2025-11")).toBe(false);
  });

  it("開始月なし・終了月なしは在籍とみなす（未入力の人が実在する）", () => {
    expect(isActiveInMonth({}, "2026-09")).toBe(true);
    expect(isActiveInMonth({ active_from_month: null, active_until_month: "2026-08" }, "2020-01")).toBe(true);
    expect(isActiveInMonth({ active_from_month: "2026-09", active_until_month: null }, "2030-12")).toBe(true);
  });

  it("形が壊れている値は無視する", () => {
    expect(isActiveInMonth({ active_from_month: "2026-13", active_until_month: "" }, "2026-01")).toBe(true);
    expect(isActiveInMonth({ active_from_month: "2026-02" }, "こわれた月")).toBe(true);
  });
});

describe("isMemberInPeriod（一覧表示用）", () => {
  const member = { status: "active", created_at: "2026-08-15T15:00:00Z" };
  it("登録日をJSTで判定し、8/16登録は前半に出ず後半に出る", () => {
    expect(isMemberInPeriod(member, "2026-08-01", "2026-08-15")).toBe(false);
    expect(isMemberInPeriod(member, "2026-08-16", "2026-08-31")).toBe(true);
    expect(isMemberInPeriod({ ...member, created_at: "2026-08-15T14:59:59Z" }, "2026-08-01", "2026-08-15")).toBe(true);
  });
  it("終了者の開始月・終了月は両端を含む（途中の日付は推測しない）", () => {
    const ended = { ...member, status: "inactive", active_from_month: "2026-07", active_until_month: "2026-08" };
    expect(isMemberInPeriod(ended, "2026-07-01", "2026-07-15")).toBe(true);
    expect(isMemberInPeriod(ended, "2026-08-16", "2026-08-31")).toBe(true);
    expect(isMemberInPeriod(ended, "2026-09-01", "2026-09-15")).toBe(false);
  });
  it("月・年を跨ぐ対象期間と所属期間が重なれば含む", () => {
    expect(isMemberInPeriod({ status: "active", active_from_month: "2027-01" }, "2026-12-16", "2027-01-15")).toBe(true);
  });
  it("明示開始月は移行登録日時より優先し、新しい開始月の前は出さない", () => {
    expect(isMemberInPeriod({ ...member, active_from_month: "2026-01" }, "2026-01-01", "2026-01-15")).toBe(true);
    expect(isMemberInPeriod({ ...member, active_from_month: "2026-09" }, "2026-08-16", "2026-08-31")).toBe(false);
  });
  it("日付欠落・不正日時の旧所属は消さず、pending/rejectedは所属とみなさない", () => {
    expect(isMemberInPeriod({ status: "inactive" }, "2020-01-01", "2020-01-31")).toBe(true);
    expect(isMemberInPeriod({ status: "active", created_at: "2026-08-16" }, "2020-01-01", "2020-01-31")).toBe(true);
    expect(isMemberInPeriod({ status: "pending" }, "2026-08-01", "2026-08-31")).toBe(false);
    expect(isMemberInPeriod({ status: "rejected" }, "2026-08-01", "2026-08-31")).toBe(false);
  });
});
