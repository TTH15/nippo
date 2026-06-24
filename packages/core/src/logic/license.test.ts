import { describe, it, expect } from "vitest";
import {
  computeLicenseLevel,
  isLicenseAlertDriver,
  countLicenseAlertDrivers,
  parseLicenseExpiryFromOcr,
} from "./license";

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

describe("parseLicenseExpiryFromOcr", () => {
  it("『…まで有効』直前の和暦日付を抽出（令和）", () => {
    // 免許の色帯: 令和10年 = 2018+10 = 2028
    expect(parseLicenseExpiryFromOcr("交付 令和5年4月1日\n令和10年3月31日まで有効")).toBe("2028-03-31");
  });

  it("平成も西暦変換できる", () => {
    expect(parseLicenseExpiryFromOcr("平成35年12月5日まで有効")).toBe("2023-12-05"); // 1988+35
  });

  it("全角数字を正規化", () => {
    expect(parseLicenseExpiryFromOcr("令和７年１月９日まで有効")).toBe("2025-01-09");
  });

  it("西暦表記もパースできる", () => {
    expect(parseLicenseExpiryFromOcr("2030年9月8日まで有効")).toBe("2030-09-08");
  });

  it("複数日付があっても有効の直前を選ぶ", () => {
    // 生年月日 昭和60年・交付 令和5年・有効 令和10年
    const text = "昭和60年1月1日生\n交付 令和5年4月1日\n令和10年3月31日まで有効";
    expect(parseLicenseExpiryFromOcr(text)).toBe("2028-03-31");
  });

  it("『有効』が無ければ最も新しい日付を返す", () => {
    expect(parseLicenseExpiryFromOcr("令和5年4月1日 交付\n令和10年3月31日")).toBe("2028-03-31");
  });

  it("日付が無ければ null", () => {
    expect(parseLicenseExpiryFromOcr("運転免許証")).toBeNull();
    expect(parseLicenseExpiryFromOcr("")).toBeNull();
  });

  it("不正な月日は除外", () => {
    expect(parseLicenseExpiryFromOcr("令和10年13月40日まで有効")).toBeNull();
  });
});
