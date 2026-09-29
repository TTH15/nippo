import { describe, expect, it } from "vitest";
import { activeAdminNavHref } from "./adminNavItems";

describe("管理メニューの現在地", () => {
  it("子ページでは最も具体的な入口だけを選ぶ", () => {
    expect(activeAdminNavHref("/admin/users/pending")).toBe("/admin/users/pending");
    expect(activeAdminNavHref("/admin/invoices/123/edit")).toBe("/admin/invoices");
  });

  it("ダッシュボードを他の管理ページで選ばない", () => {
    expect(activeAdminNavHref("/admin")).toBe("/admin");
    expect(activeAdminNavHref("/admin/shifts")).toBe("/admin/shifts");
  });
});
