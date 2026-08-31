import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

afterEach(cleanup);
beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
describe("本番シフトページの表示操作", () => {
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
