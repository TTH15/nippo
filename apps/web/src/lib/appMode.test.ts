import { describe, it, expect } from "vitest";
import { resolveHomePath } from "./appMode";

// ============================================================
// ログイン後・トップ着地時の遷移先。
// 「スマホで前回ドライバー画面だったのに毎回運営画面が出る」を直すのが目的。
// 逆方向の事故（権限が無いのに /admin へ送る）も同時に防ぐ。
// ============================================================

describe("resolveHomePath", () => {
  it("運営権限が無ければ常にドライバー画面", () => {
    for (const lastMode of ["admin", "driver", null] as const) {
      for (const isMobile of [true, false]) {
        expect(resolveHomePath({ hasAdminAccess: false, lastMode, isMobile })).toBe("/submit");
      }
    }
  });

  it("スマホで前回ドライバー画面ならドライバー画面へ戻す", () => {
    expect(resolveHomePath({ hasAdminAccess: true, lastMode: "driver", isMobile: true })).toBe(
      "/submit",
    );
  });

  it("スマホで前回運営画面なら運営画面へ", () => {
    expect(resolveHomePath({ hasAdminAccess: true, lastMode: "admin", isMobile: true })).toBe(
      "/admin",
    );
  });

  it("記録が無ければ運営画面（従来どおりの既定）", () => {
    expect(resolveHomePath({ hasAdminAccess: true, lastMode: null, isMobile: true })).toBe("/admin");
  });

  it("PC では前回ドライバー画面でも運営画面へ（ドライバー画面はPC非対応のため）", () => {
    expect(resolveHomePath({ hasAdminAccess: true, lastMode: "driver", isMobile: false })).toBe(
      "/admin",
    );
  });
});
