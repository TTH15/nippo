import { describe, it, expect } from "vitest";
import { CAPABILITIES, DEFAULT_ROLE_CAPABILITIES, type Capability } from "./capabilities";

// 認可カタログと system 既定束の不変条件。migration 092 の seed と一致していること。
describe("capability catalog", () => {
  it("capability に重複が無い", () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });

  it("既定束は実在する capability だけを参照する", () => {
    const valid = new Set<string>(CAPABILITIES);
    for (const [role, caps] of Object.entries(DEFAULT_ROLE_CAPABILITIES)) {
      for (const c of caps) {
        expect(valid.has(c), `${role} の ${c} はカタログ外`).toBe(true);
      }
      // 束内の重複も禁止
      expect(new Set(caps).size, `${role} に重複`).toBe(caps.length);
    }
  });

  it("ADMIN は全 capability を持つ（フル権限）", () => {
    expect(new Set(DEFAULT_ROLE_CAPABILITIES.ADMIN)).toEqual(new Set(CAPABILITIES));
  });

  it("DRIVER は admin ドメイン capability を持たない", () => {
    expect(DEFAULT_ROLE_CAPABILITIES.DRIVER).toEqual([]);
  });

  it("ADMIN_VIEWER / ACCOUNTING は ADMIN の部分集合", () => {
    const admin = new Set<Capability>(DEFAULT_ROLE_CAPABILITIES.ADMIN);
    for (const role of ["ADMIN_VIEWER", "ACCOUNTING"] as const) {
      for (const c of DEFAULT_ROLE_CAPABILITIES[role]) {
        expect(admin.has(c)).toBe(true);
      }
    }
  });

  it("ADMIN_VIEWER は PII・口座を閲覧できない（最小権限）", () => {
    const viewer = new Set(DEFAULT_ROLE_CAPABILITIES.ADMIN_VIEWER);
    expect(viewer.has("can_view_pii")).toBe(false);
    expect(viewer.has("can_view_bank_accounts")).toBe(false);
  });

  it("ACCOUNTING は PII を閲覧できないが報酬・請求は管理できる", () => {
    const acct = new Set(DEFAULT_ROLE_CAPABILITIES.ACCOUNTING);
    expect(acct.has("can_view_pii")).toBe(false);
    expect(acct.has("can_view_bank_accounts")).toBe(true);
    expect(acct.has("can_manage_rewards")).toBe(true);
    expect(acct.has("can_manage_billing")).toBe(true);
    // 経理はシフト管理やメンバー承認はしない
    expect(acct.has("can_manage_shifts")).toBe(false);
    expect(acct.has("can_approve_members")).toBe(false);
  });

  it("VIEWER/ACCOUNTING は名簿・設定を閲覧できるが設定編集はできない", () => {
    for (const role of ["ADMIN_VIEWER", "ACCOUNTING"] as const) {
      const caps = new Set(DEFAULT_ROLE_CAPABILITIES[role]);
      expect(caps.has("can_view_members")).toBe(true);
      expect(caps.has("can_view_org_settings")).toBe(true);
      expect(caps.has("can_manage_org_settings")).toBe(false);
      expect(caps.has("can_manage_members")).toBe(false);
    }
  });
});
