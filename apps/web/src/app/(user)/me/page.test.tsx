import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MePageContent } from "./page";
const mocks = vi.hoisted(() => ({ bundle: { vehicles: [] as { id: string }[], unlinked: [] as { id: string }[] }, error: undefined as Error | undefined, refresh: vi.fn(), kinds: { kinds: [{ key: "oil_change", label: "オイル交換", vehicleMode: "required", fields: [] }] } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/useApi", () => ({ useApi: (key: string) => ({
  data: key === "me/report-vehicles" ? mocks.bundle : key === "/api/me/report-kinds" ? mocks.kinds : undefined,
  isInitialLoading: false, error: key === "me/report-vehicles" ? mocks.error : undefined, refresh: mocks.refresh,
}) }));
vi.mock("@/lib/components/VehiclePlate", () => ({ VehiclePlate: ({ vehicle }: { vehicle: { id: string } }) => <span>{vehicle.id}</span> }));
describe("諸報告の車両選択", () => {
  beforeEach(() => { mocks.bundle = { vehicles: [], unlinked: [] }; mocks.error = undefined; mocks.refresh.mockClear(); });
  it("紐付け車がなくても他車を選べる", () => {
    mocks.bundle.unlinked = [{ id: "other-vehicle" }];
    render(<MePageContent forceReport />);
    expect(screen.queryByText(/選択可能な車両がありません/)).toBeNull();
    const vehicle = screen.getByRole("button", { name: "other-vehicle" });
    fireEvent.click(vehicle);
    expect(vehicle.className).toContain("border-slate-900");
  });
  it("両一覧とも空の場合だけ車両なしを表示する", () => {
    render(<MePageContent forceReport />);
    expect(screen.getByText(/選択可能な車両がありません/)).toBeInTheDocument();
  });
  it("取得エラーは空一覧と区別し再取得できる", () => {
    mocks.error = new Error("fetch failed");
    render(<MePageContent forceReport />);
    expect(screen.queryByText(/選択可能な車両がありません/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
