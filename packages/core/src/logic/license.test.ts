import { describe, it, expect } from "vitest";
import { computeLicenseLevel, isLicenseAlertDriver, countLicenseAlertDrivers } from "./license";

// 基準日を 2026-06-21 に固定し、有効期限との距離でレベルが切り替わることを確認する。
const now = new Date(2026, 5, 21); // 月は0始まり（5 = 6月）

describe("computeLicenseLevel", () => {
  it("未設定/不正な形式は unset", () => {
    expect(computeLicenseLevel(null, now)).toBe("unset");
    expect(computeLicenseLevel(undefined, now)).toBe("unset");
    expect(computeLicenseLevel("", now)).toBe("unset");
    expect(computeLicenseLevel("2026/06/21", now)).toBe("unset");
  });

  it("2ヶ月より先は safe", () => {
    expect(computeLicenseLevel("2026-09-01", now)).toBe("safe");
  });

  it("2ヶ月以内は within2Months", () => {
    expect(computeLicenseLevel("2026-08-10", now)).toBe("within2Months");
  });

  it("1ヶ月以内は within1Month", () => {
    expect(computeLicenseLevel("2026-07-10", now)).toBe("within1Month");
  });

  it("当日・経過後は expired", () => {
    expect(computeLicenseLevel("2026-06-21", now)).toBe("expired");
    expect(computeLicenseLevel("2026-06-01", now)).toBe("expired");
  });
});

describe("isLicenseAlertDriver", () => {
  it("2ヶ月以内・1ヶ月以内・期限切れは対象", () => {
    expect(isLicenseAlertDriver({ license_expiry_date: "2026-08-10" }, now)).toBe(true);
    expect(isLicenseAlertDriver({ license_expiry_date: "2026-07-10" }, now)).toBe(true);
    expect(isLicenseAlertDriver({ license_expiry_date: "2026-06-01" }, now)).toBe(true);
  });

  it("通常・未設定は対象外", () => {
    expect(isLicenseAlertDriver({ license_expiry_date: "2026-09-01" }, now)).toBe(false);
    expect(isLicenseAlertDriver({ license_expiry_date: null }, now)).toBe(false);
  });
});

describe("countLicenseAlertDrivers", () => {
  it("迫っているドライバーのみ数える", () => {
    const drivers = [
      { license_expiry_date: "2026-09-01" }, // safe
      { license_expiry_date: "2026-08-10" }, // within2Months
      { license_expiry_date: "2026-07-10" }, // within1Month
      { license_expiry_date: "2026-06-01" }, // expired
      { license_expiry_date: null }, // unset
    ];
    expect(countLicenseAlertDrivers(drivers, now)).toBe(3);
  });
});
