import { describe, expect, it } from "vitest";
import { activeAdminNavHref, adminNavItems } from "./adminNavItems";

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

it("シフト表とメモを同じ閲覧権限の別メニューにする", () => {
  const group = adminNavItems.find(item => item.label === "シフト");
  expect(group?.children?.slice(0,2).map(item => [item.href,item.label,item.cap])).toEqual([
    ["/admin/shifts","シフト表","can_view_shifts"],["/admin/shift-memos","シフトメモ","can_view_shifts"],
  ]);
  expect(activeAdminNavHref("/admin/shift-memos")).toBe("/admin/shift-memos");
});
