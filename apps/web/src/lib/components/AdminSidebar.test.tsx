import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { setAdminSidebarOpen } from "@/lib/hooks/useAdminSidebarOpen";
import { AdminSidebar } from "./AdminSidebar";
import { AdminPreviewLayout } from "@/app/preview/driver-leases/AdminPreviewLayout";

afterEach(() => { cleanup(); setAdminSidebarOpen(true); });

it("開閉ボタンのフォーカスとメニュー内の状態を保ち、閉じ始めた内容を操作対象から外す", () => {
  function Menu() {
    const [value, setValue] = useState("");
    return <input aria-label="メニューの絞り込み" value={value} onChange={event => setValue(event.target.value)}/>;
  }
  render(<AdminSidebar logo={<span>ロゴ</span>}><Menu/></AdminSidebar>);
  const toggle = screen.getByRole("button", { name: "メニューを閉じる" });
  const content = document.getElementById(toggle.getAttribute("aria-controls")!);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "シフト" } });
  toggle.focus();
  fireEvent.click(toggle);
  expect(toggle).toHaveFocus();
  expect(screen.getByRole("button", { name: "メニューを開く" })).toBe(toggle);
  expect(content).toHaveAttribute("inert");
  expect(content).toHaveAttribute("aria-hidden", "true");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(toggle).toHaveFocus();
  expect(content).not.toHaveAttribute("inert");
  expect(screen.getByRole("textbox")).toHaveValue("シフト");
});

it("実メニューのアイコンと小メニューを同じDOMで保持し、閉じた親項目から展開できる", () => {
  render(<AdminPreviewLayout pathname="/admin/shift-memos" onReset={vi.fn()}><div>ページ</div></AdminPreviewLayout>);
  const sidebar = screen.getByRole("complementary", { name: "管理サイドバー" });
  const shift = sidebar.querySelector<HTMLButtonElement>('#admin-nav-シフト-button')!;
  const icon = shift.querySelector("svg");
  const child = sidebar.querySelector('[aria-label="シフトメモ"]');
  const settings = sidebar.querySelector<HTMLButtonElement>('#admin-nav-設定-button')!;
  fireEvent.click(sidebar.querySelector('[aria-label="メニューを閉じる"]')!);
  expect(sidebar).toHaveAttribute("data-sidebar-open", "false");
  expect(shift.querySelector("svg")).toBe(icon);
  expect(sidebar.querySelector('[aria-label="シフトメモ"]')).toBe(child);
  expect(shift.closest("[inert]")).toBeNull();
  expect(shift).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(settings);
  expect(sidebar).toHaveAttribute("data-sidebar-open", "true");
  expect(settings).toHaveAttribute("aria-expanded", "true");
  expect(settings).toHaveFocus();
});

it("閉じても閲覧権限のないメニューを操作可能にしない", () => {
  render(<AdminPreviewLayout pathname="/admin/shifts" onReset={vi.fn()}
    viewer={{ name: "閲覧者", role: "ADMIN_VIEWER", capabilities: ["can_view_shifts"] }}><div>ページ</div></AdminPreviewLayout>);
  const sidebar = screen.getByRole("complementary", { name: "管理サイドバー" });
  fireEvent.click(sidebar.querySelector('[aria-label="メニューを閉じる"]')!);
  expect(sidebar.querySelector('[aria-label="報告"]')).toHaveAttribute("aria-disabled", "true");
  expect(sidebar.querySelector('#admin-nav-報告-button')).toBeNull();
  expect(sidebar.querySelector('#admin-nav-シフト-button')).not.toBeNull();
});

it("下層ページへの移動で管理レイアウトが再マウントされても閉じ幅と展開中の小メニューを維持する", () => {
  const view = (pathname: string) => <AdminPreviewLayout key={pathname} pathname={pathname} onReset={vi.fn()}><div>ページ</div></AdminPreviewLayout>;
  const { rerender } = render(view("/admin/shift-memos"));
  fireEvent.click(screen.getByRole("complementary", { name: "管理サイドバー" }).querySelector('[aria-label="メニューを閉じる"]')!);
  rerender(view("/admin/shifts"));
  const sidebar = screen.getByRole("complementary", { name: "管理サイドバー" });
  expect(sidebar).toHaveAttribute("data-sidebar-open", "false");
  expect(sidebar.firstElementChild).toHaveStyle({ width: "64px" });
  expect(sidebar.querySelector('#admin-nav-シフト-button')).toHaveAttribute("aria-expanded", "true");
  expect(sidebar.querySelector('[aria-label="シフト表"]')).toHaveAttribute("aria-current", "page");
  rerender(view("/admin/shift-memos"));
  expect(screen.getByRole("complementary", { name: "管理サイドバー" })).toHaveAttribute("data-sidebar-open", "false");
});
