import { describe, it, expect } from "vitest";
import { digitsOnly, validatePinChange, buildProfileEntries } from "./profile";
import type { Profile } from "../types";

describe("digitsOnly", () => {
  it("数字以外を除去", () => {
    expect(digitsOnly("1a2b3")).toBe("123");
    expect(digitsOnly("１2３")).toBe("2");
  });
});

describe("validatePinChange", () => {
  it("6桁数字・一致なら ok", () => {
    expect(validatePinChange("123456", "123456")).toEqual({ ok: true });
  });
  it("6桁でなければ NG", () => {
    expect(validatePinChange("123", "123").ok).toBe(false);
  });
  it("数字以外を含めば NG", () => {
    expect(validatePinChange("12345a", "12345a").ok).toBe(false);
  });
  it("確認不一致は NG", () => {
    const r = validatePinChange("123456", "654321");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("一致");
  });
});

describe("buildProfileEntries", () => {
  const base: Profile = {
    name: "山田太郎",
    officeCode: "OF1",
    driverCode: "D1",
    displayName: "タロウ",
    postalCode: "",
    address: "",
    phone: "090",
    bankName: "",
    bankNo: "",
    bankHolder: "",
  };
  it("空値を除外し順序を保つ", () => {
    const entries = buildProfileEntries(base);
    expect(entries.map((e) => e.label)).toEqual([
      "名前",
      "表示名",
      "ドライバーコード",
      "営業所コード",
      "電話番号",
    ]);
  });
  it("null は空配列", () => {
    expect(buildProfileEntries(null)).toEqual([]);
  });
});
