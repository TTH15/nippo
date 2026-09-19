import { describe, expect, it } from "vitest";
import {
  DEFAULT_READINESS_SETTINGS,
  dueDaysFor,
  parseReadinessSettings,
  settingsFromRow,
} from "./readinessSettings";

const valid = { staffingDueDays: 3, confirmationDueDays: 2, dispatchDueDays: 1, horizonDays: 14 };

describe("dueDaysFor", () => {
  it("区分ごとの日数を返す", () => {
    expect(dueDaysFor("shortage", valid)).toBe(3);
    expect(dueDaysFor("source_mismatch", valid)).toBe(3);
    expect(dueDaysFor("unconfirmed", valid)).toBe(2);
    expect(dueDaysFor("unavailable", valid)).toBe(2);
    expect(dueDaysFor("no_vehicle", valid)).toBe(1);
  });

  it("特定の日の話でない項目は期限を持たない", () => {
    expect(dueDaysFor("baseline_missing", valid)).toBeNull();
  });

  it("既定値は2026-09-17まで固定していた値と同じ", () => {
    expect(DEFAULT_READINESS_SETTINGS).toEqual(valid);
  });
});

describe("parseReadinessSettings", () => {
  it("正しい設定を通す", () => {
    expect(parseReadinessSettings(valid)).toMatchObject({ ok: true, value: valid });
  });

  it("0日前（当日まで）は有効", () => {
    expect(parseReadinessSettings({ ...valid, dispatchDueDays: 0 })).toMatchObject({ ok: true });
  });

  it("先読みが一番長い期限より短ければ拒否する", () => {
    const result = parseReadinessSettings({ ...valid, staffingDueDays: 20, horizonDays: 14 });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("20日前");
  });

  it("範囲外・小数・欠けを拒否する", () => {
    expect(parseReadinessSettings({ ...valid, staffingDueDays: 31 })).toMatchObject({ ok: false });
    expect(parseReadinessSettings({ ...valid, staffingDueDays: -1 })).toMatchObject({ ok: false });
    expect(parseReadinessSettings({ ...valid, confirmationDueDays: 1.5 })).toMatchObject({ ok: false });
    expect(parseReadinessSettings({ ...valid, horizonDays: 0 })).toMatchObject({ ok: false });
    expect(parseReadinessSettings({ ...valid, horizonDays: 61 })).toMatchObject({ ok: false });
    expect(parseReadinessSettings({ staffingDueDays: 3 })).toMatchObject({ ok: false });
    expect(parseReadinessSettings(null)).toMatchObject({ ok: false });
  });
});

describe("settingsFromRow", () => {
  it("行が無ければ既定値", () => {
    expect(settingsFromRow(null)).toEqual(DEFAULT_READINESS_SETTINGS);
  });

  it("DBの列名から読む", () => {
    expect(settingsFromRow({ staffing_due_days: 5, confirmation_due_days: 4, dispatch_due_days: 2, horizon_days: 21 }))
      .toEqual({ staffingDueDays: 5, confirmationDueDays: 4, dispatchDueDays: 2, horizonDays: 21 });
  });

  it("壊れた値は既定値で埋める（設定のせいで一覧を消さない）", () => {
    expect(settingsFromRow({ staffing_due_days: null, confirmation_due_days: "x", dispatch_due_days: 99, horizon_days: 14 }))
      .toEqual(DEFAULT_READINESS_SETTINGS);
  });

  it("先読みが期限より短い行は、先読みを広げて読む", () => {
    expect(settingsFromRow({ staffing_due_days: 20, confirmation_due_days: 2, dispatch_due_days: 1, horizon_days: 5 }))
      .toMatchObject({ horizonDays: 20 });
  });
});
