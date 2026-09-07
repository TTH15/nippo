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
    if (u.includes("/api/reports/parking-places")) {
      return Promise.resolve({ places: [
        { id: "p1", name: "豊中センター", lat: 34.78, lng: 135.47, icon: "warehouse", slots: [{ id: "s1", label: "A-1", vehicleId: "v1" }, { id: "s2", label: "A-2", vehicleId: null }] },
        { id: "p2", name: "京都車庫", lat: 35.01, lng: 135.76, icon: "warehouse", slots: [] },
      ] });
    }
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

  it("車両の登録値より大きい走行距離なら送信できる（置き場所は回答が必要）", async () => {
    mockEndpoints({ mileage: 50000 });
    render(<SubmitPageClientV2 />);
    await selectVehicleAndType("50001");
    await userEvent.click(screen.getByRole("button", { name: "あとで記録" }));
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(wasPosted()).toBe(true));
    expect(postedBody().items[0]).toMatchObject({ courseId: "c1", cycleNo: 1 });
    expect(postedBody().parking).toMatchObject({ vehicleId: "v1", status: "later", placeId: null, slotId: null });
  });
});

describe("SubmitPageClientV2 — 車の置き場所", () => {
  beforeEach(() => mockApiFetch.mockReset());

  it("車両を選んだのに置き場所が未回答なら送信をブロックする", async () => {
    mockEndpoints({ mileage: 50000 });
    render(<SubmitPageClientV2 />);
    await selectVehicleAndType("50001");
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(await screen.findAllByText(/車の置き場所を選んでください/)).not.toHaveLength(0);
    expect(wasPosted()).toBe(false);
  });

  it("いつもの区画がある車庫を選ぶと区画が自動で選ばれ、送信内容に車庫・区画・メモが入る", async () => {
    mockEndpoints({ mileage: 50000 });
    render(<SubmitPageClientV2 />);
    await selectVehicleAndType("50001");
    const toyonaka = await screen.findByRole("button", { name: /豊中センター/ });
    expect(toyonaka).toHaveTextContent("いつもの");
    await userEvent.click(toyonaka);
    expect(screen.getByRole("button", { name: "A-1" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.type(screen.getByPlaceholderText(/鍵の場所/), "鍵は事務所");
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(wasPosted()).toBe(true));
    const parking = postedBody().parking;
    expect(parking).toMatchObject({ vehicleId: "v1", status: "parked", placeId: "p1", slotId: "s1", placeName: null, note: "鍵は事務所" });
    expect(typeof parking.clientKey).toBe("string");
  });

  it("別の場所は名前が必要で、名前を入れると placeName で送る", async () => {
    mockEndpoints({ mileage: 50000 });
    render(<SubmitPageClientV2 />);
    await selectVehicleAndType("50001");
    await userEvent.click(await screen.findByRole("button", { name: "別の場所" }));
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(await screen.findAllByText(/場所の名前を入れてください/)).not.toHaveLength(0);
    expect(wasPosted()).toBe(false);
    await userEvent.type(screen.getByPlaceholderText(/場所の名前/), "駅前コインパーキング");
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(wasPosted()).toBe(true));
    expect(postedBody().parking).toMatchObject({ status: "parked", placeId: null, placeName: "駅前コインパーキング" });
  });
});
