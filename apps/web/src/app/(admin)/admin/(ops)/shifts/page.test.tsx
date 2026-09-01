import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("@/lib/api", () => import("../../../../../../../../scripts/previews/shifts-services"));
vi.mock("@/lib/useApi", () => import("../../../../../../../../scripts/previews/shifts-services"));
vi.mock("@/lib/capabilities", () => import("../../../../../../../../scripts/previews/shifts-services"));
vi.mock("@/lib/realtime/cellCursors", () => import("../../../../../../../../scripts/previews/shifts-services"));
vi.mock("@/lib/swr", () => import("../../../../../../../../scripts/previews/shifts-services"));
vi.mock("swr", () => import("../../../../../../../../scripts/previews/shifts-services"));
vi.mock("@/server/shiftRequests/diff", () => import("../../../../../../../../scripts/previews/shifts-services"));
vi.mock("@/lib/components/AdminLayout", () => ({ AdminLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/components/VehiclePlate", () => ({
  formatPlateNumeric: (value: string) => value,
  VehiclePlate: ({ vehicle }: { vehicle: { id: string } }) => <span data-testid="vehicle-plate">{vehicle.id}</span>,
}));
import ShiftsPage from "./page";
import { resetPreviewShifts, setPreviewLeaseScenario } from "../../../../../../../../scripts/previews/shifts-services";

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => { localStorage.clear(); resetPreviewShifts(); vi.setSystemTime(new Date("2026-08-31T12:00:00+09:00")); Element.prototype.scrollIntoView = vi.fn(); });
describe("本番シフトページの表示操作", () => {
  it("契約区分を表示し、月替わり・絞り込み・段分け解除が予定を書き換えず反映される", async () => {
    render(<ShiftsPage />);
    const table = await screen.findByRole("table", { name: "ドライバー別シフト表" });
    expect(within(table).getByRole("columnheader", { name: "月額リース 3人" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "日額リース 5人" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "9月前半を表示" }));
    await waitFor(() => expect(within(table).getByRole("columnheader", { name: "月額リース 4人" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    const displayPanel = screen.getByRole("region", { name: "表示" });
    fireEvent.click(within(displayPanel).getByRole("button", { name: "リース区分で絞り込み" }));
    fireEvent.click(screen.getByRole("button", { name: "月額リース" }));
    expect(within(table).queryByText("田中")).not.toBeInTheDocument();
    expect(within(table).getAllByText("佐藤").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^全員\s*4$/ })).toBeInTheDocument();
    fireEvent.click(within(displayPanel).getByRole("checkbox", { name: "契約区分でまとめる" }));
    expect(within(table).queryByRole("columnheader", { name: "月額リース 4人" })).not.toBeInTheDocument();
    expect(within(table).getAllByText("月額リース")).toHaveLength(4);
    fireEvent.click(within(displayPanel).getByRole("button", { name: "契約区分" }));
    expect(within(table).queryByText("月額リース")).not.toBeInTheDocument();
    expect(within(table).getAllByTestId("vehicle-plate").length).toBeGreaterThan(0);
  });
  it("取得失敗でリースなしに分類せず、再読込で区分表示へ戻る", async () => {
    setPreviewLeaseScenario("error");
    render(<ShiftsPage />);
    const table = await screen.findByRole("table", { name: "ドライバー別シフト表" });
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    const displayPanel = screen.getByRole("region", { name: "表示" });
    expect(within(displayPanel).getByRole("alert")).toHaveTextContent("契約区分を取得できませんでした");
    expect(within(table).queryByText("リースなし")).not.toBeInTheDocument();
    expect(within(table).getAllByText("佐藤").length).toBeGreaterThan(0);
    expect(within(displayPanel).getByRole("button", { name: "リース区分で絞り込み" })).toBeDisabled();
    fireEvent.click(within(displayPanel).getByRole("button", { name: "再読み込み" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(within(table).getByRole("columnheader", { name: "月額リース 3人" })).toBeInTheDocument();
  });
  it("未設定はリースなし、月額フィルターが0件でも条件を戻せる", async () => {
    render(<ShiftsPage />);
    const table = await screen.findByRole("table", { name: "ドライバー別シフト表" });
    act(() => setPreviewLeaseScenario("empty"));
    expect(within(table).getByRole("columnheader", { name: "リースなし 12人" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    const displayPanel = screen.getByRole("region", { name: "表示" });
    fireEvent.click(within(displayPanel).getByRole("button", { name: "リース区分で絞り込み" }));
    fireEvent.click(screen.getByRole("button", { name: "月額リース" }));
    expect(within(table).getByText(/該当するドライバーはいません/)).toBeInTheDocument();
    fireEvent.click(within(displayPanel).getByRole("button", { name: "リース区分で絞り込み" }));
    fireEvent.click(screen.getByRole("button", { name: "すべての契約" }));
    expect(within(table).getAllByText("佐藤").length).toBeGreaterThan(0);
  });
  it("旧密度設定を引き継ぎ、表示パネルで車両・時刻を切り替える", async () => {
    localStorage.setItem("shifts_view_density", "compact");
    render(<ShiftsPage />);
    await screen.findByRole("button", { name: "表示" });
    expect(screen.queryByRole("button", { name: "標準" })).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "ドライバー別シフト表" });
    expect(within(table).queryAllByTestId("vehicle-plate")).toHaveLength(0);
    const period = screen.getByRole("group", { name: "表示する年月と期間" });
    expect(within(period).getByRole("button", { name: /年.*月/ })).toBeInTheDocument();
    expect(within(period).getByRole("button", { name: /^前半\s*（1〜15日）$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    const options = screen.getByRole("group", { name: "表示する項目" });
    fireEvent.click(within(options).getByRole("button", { name: "車両" }));
    expect(within(table).getAllByTestId("vehicle-plate").length).toBeGreaterThan(0);
    fireEvent.click(within(options).getByRole("button", { name: "集合時刻" }));
    expect(screen.getAllByText("集合 07:30").length).toBeGreaterThan(0);
    fireEvent.click(within(options).getByRole("button", { name: "シフト" }));
    expect(JSON.parse(localStorage.getItem("shifts_display_items")!)).toEqual({ shift: false, vehicle: true, meetingTime: true });
    expect(screen.getByRole("button", { name: /^全員\s*12$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^稼働\s*\d+$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^未割当\s*\d+$/ })).toBeInTheDocument();
  });
});
