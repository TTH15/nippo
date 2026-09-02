// 日報提出フォーム（現役 v2）の探索的テスト。
//   特に「走行距離（オドメーター）が車両の登録値より小さい/同じ」という
//   あり得ない入力で送信がブロックされるかを検証する。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/components/DatePicker", () => ({ DatePicker: () => <div data-testid="datepicker" /> }));
vi.mock("@/lib/components/VehiclePlate", () => ({ VehiclePlate: ({ vehicle }: { vehicle: { id: string } }) => <div>plate-{vehicle.id}</div> }));
vi.mock("@/lib/components/PostSubmitView", () => ({ PostSubmitView: () => <div>post-submit</div> }));
vi.mock("@/lib/components/Skeleton", () => ({ Skeleton: () => <div data-testid="skeleton" /> }));

import SubmitPageClientV2 from "./SubmitPageClientV2";
import { apiFetch } from "@/lib/api";
const mockApiFetch = vi.mocked(apiFetch);

// 1台の紐付け車両 + 1シフトを返す標準モック。mileage/isEv を差し替え可能。
function mockEndpoints({ mileage = 50000, isEv = false }: { mileage?: number; isEv?: boolean } = {}) {
  mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
    const u = String(url);
    if (opts?.method === "POST" && u.includes("/api/reports/v2")) return Promise.resolve({});
    if (u.includes("/api/reports/profile")) return Promise.resolve({ identities: [{ id: "id1", slot: 1, driverCode: "D1", officeCode: "O1" }] });
    if (u.includes("/api/reports/vehicles-unlinked")) return Promise.resolve({ vehicles: [] });
    if (u.includes("/api/reports/vehicles")) return Promise.resolve({ vehicles: [{ id: "v1", current_mileage: mileage, is_ev: isEv, number_numeric: "1234" }] });
    if (u.includes("/api/me/report-form")) {
      return Promise.resolve({
        shifts: [{ courseId: "c1", cycleNo: 1, cycleLabel: "C1", courseName: "コースA", color: null, carrierId: null, carrierName: "", units: [], existing: null }],
        shiftVehicleId: null,
      });
    }
    if (u.includes("/api/me/submit-screen")) return Promise.resolve({});
    return Promise.resolve({});
  });
}

const wasPosted = () =>
  mockApiFetch.mock.calls.some(
    ([u, o]) => String(u).includes("/api/reports/v2") && (o as { method?: string } | undefined)?.method === "POST",
  );

const postedBody = () => {
  const call = mockApiFetch.mock.calls.find(
    ([u, o]) => String(u).includes("/api/reports/v2") && (o as RequestInit | undefined)?.method === "POST",
  );
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : null;
};

async function selectVehicleAndType(meterValue: string) {
  await waitFor(() => expect(screen.getByText("plate-v1")).toBeInTheDocument());
  await userEvent.click(screen.getByText("plate-v1").closest("button")!);
  const meterInput = await screen.findByPlaceholderText(/現在:/);
  await userEvent.type(meterInput, meterValue);
}

describe("SubmitPageClientV2 — 走行距離の妥当性（探索的）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("車両の登録値より小さい走行距離では送信がブロックされる", async () => {
    mockEndpoints({ mileage: 50000 });
    render(<SubmitPageClientV2 />);
    await selectVehicleAndType("49000"); // 登録値 50000 より小さい
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(wasPosted()).toBe(false);
  });

  it("車両の登録値と同じ走行距離でも送信がブロックされる", async () => {
    mockEndpoints({ mileage: 50000 });
    render(<SubmitPageClientV2 />);
    await selectVehicleAndType("50000"); // 同値（登録値より大きくない）
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(wasPosted()).toBe(false);
  });

  it("車両の登録値より大きい走行距離なら送信できる", async () => {
    mockEndpoints({ mileage: 50000 });
    render(<SubmitPageClientV2 />);
    await selectVehicleAndType("50001");
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(wasPosted()).toBe(true));
    expect(postedBody().items[0]).toMatchObject({ courseId: "c1", cycleNo: 1 });
  });
});
