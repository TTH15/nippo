// 日報提出フォーム（現役 v2）の探索的テスト。
//   特に「走行距離（オドメーター）が車両の登録値より小さい/同じ」という
//   あり得ない入力で送信がブロックされるかを検証する。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect } from "react";
import { SWRConfig } from "swr";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/components/DatePicker", () => ({ DatePicker: ({ onChange }: { onChange: (date: Date) => void }) => <button type="button" onClick={() => onChange(new Date(2026, 10, 23, 12))}>前日を選ぶ</button> }));
vi.mock("@/lib/components/VehiclePlate", () => ({ VehiclePlate: ({ vehicle }: { vehicle: { id: string } }) => <div>plate-{vehicle.id}</div> }));
vi.mock("@/lib/components/Skeleton", () => ({ Skeleton: () => <div data-testid="skeleton" /> }));

const locationMock = vi.hoisted(() => ({ locate: vi.fn() }));
vi.mock("@/lib/map/reportParkingLocation", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/map/reportParkingLocation")>(), getParkingFix: locationMock.locate,
}));
const mapMock = vi.hoisted(() => ({ status: "ready" as "ready" | "unavailable" }));
vi.mock("@/lib/map/ReportParkingMap", () => ({
  default: function MockParkingMap({ onPin, onPlace, onStatus, places, selectedPlaceId, currentFix, center }: import("@/lib/map/ReportParkingMap").ParkingMapProps) {
    useEffect(() => onStatus(mapMock.status), [onStatus]);
    return <>
      <span hidden data-testid="parking-camera-target">{center ? `${center.lat},${center.lng}` : ""}</span>
      {currentFix && <span role="img" aria-label="現在地" />}
      <button type="button" onClick={() => onPin({ lat: 34.69, lng: 135.5 })}>地図にピンを置く</button>
      {mapMock.status === "ready" && places.map(place => <button type="button" key={place.id} aria-pressed={selectedPlaceId === place.id} aria-label={`地図で ${place.name} を選ぶ`} onClick={() => onPlace(place.id)}>{place.name}</button>)}
    </>;
  },
}));
vi.mock("@/lib/date", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/date")>(),
  todayJST: () => "2026-11-24", reportDateDefaultJST: () => "2026-11-24",
}));

import SubmitPageClientV2 from "./SubmitPageClientV2";
import { apiFetch } from "@/lib/api";
const mockApiFetch = vi.mocked(apiFetch);
beforeEach(() => { sessionStorage.clear(); mapMock.status = "ready"; });

// 1台の紐付け車両 + 1シフトを返す標準モック。mileage/isEv を差し替え可能。
const course = { courseId: "c1", cycleNo: 1, cycleLabel: "C1", courseName: "コースA", color: null, carrierId: null, carrierName: "", units: [], existing: null };
function mockEndpoints({ mileage = 50000, isEv = false, candidates = [], parkingFails = false, monthly = false, resume, postScreen, postReport }: {
  mileage?: number; isEv?: boolean; candidates?: typeof course[]; parkingFails?: boolean; monthly?: boolean; resume?: object;
  postScreen?: () => Promise<unknown>; postReport?: () => Promise<unknown>;
} = {}) {
  let tries = 0;
  locationMock.locate.mockReset().mockResolvedValue(null);
  mockApiFetch.mockImplementation((url: string, opts?: { method?: string }) => {
    const u = String(url);
    if (u === "/api/reports/v2/parking" && opts?.method === "POST") {
      if (parkingFails && ++tries === 1) return Promise.reject(new Error("駐車場所を記録できませんでした"));
      return Promise.resolve({ parkingSaved: true });
    }
    if (u.startsWith("/api/reports/v2/parking?")) return Promise.resolve(resume ?? { stage: "not_found" });
    if (opts?.method === "POST" && u === "/api/reports/v2") {
      const vehicleId = JSON.parse(String((opts as RequestInit).body)).items[0]?.vehicleId;
      return postReport?.() ?? Promise.resolve({ reportSaved: true, parkingStage: monthly || !vehicleId ? "not_required" : "required", parkingVehicleId: vehicleId });
    }
    if (u.includes("/api/me/login-setup")) return Promise.resolve({ phoneVerified: false, phoneMasked: "下4桁 0001", hasPasskey: false });
    if (u.includes("/api/reports/profile")) return Promise.resolve({ identities: [{ id: "id1", slot: 1, driverCode: "D1", officeCode: "O1" }] });
    if (u.includes("/api/reports/vehicles-unlinked")) return Promise.resolve({ vehicles: [] });
    if (u.includes("/api/reports/vehicles")) return Promise.resolve({ vehicles: [{ id: "v1", current_mileage: mileage, is_ev: isEv, number_numeric: "1234" }] });
    if (u.includes("/api/reports/parking-places")) {
      return Promise.resolve({ places: [
        { id: "p2", name: "京都車庫", lat: 35.01, lng: 135.76, icon: "warehouse", slots: [{ id: "s3", label: "B-1", vehicleId: null }] },
        { id: "p1", name: "豊中センター", lat: 34.78, lng: 135.47, icon: "warehouse", slots: [{ id: "s1", label: "A-1", vehicleId: "v1" }, { id: "s2", label: "A-2", vehicleId: null }] },
      ] });
    }
    if (u.includes("/api/me/report-form")) {
      return Promise.resolve({
        shifts: [course],
        candidates,
        revision: "form-revision",
        vehicleReturnRequired: !monthly,
        shiftVehicleId: null,
      });
    }
    if (u.includes("/api/me/submit-screen")) return postScreen?.() ?? Promise.resolve({ blocks: [] });
    return Promise.resolve({});
  });
}

const wasPosted = () =>
  mockApiFetch.mock.calls.some(
    ([u, o]) => u === "/api/reports/v2" && (o as { method?: string } | undefined)?.method === "POST",
  );

const postedBody = () => {
  const call = mockApiFetch.mock.calls.find(
    ([u, o]) => u === "/api/reports/v2" && (o as RequestInit | undefined)?.method === "POST",
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
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    await selectVehicleAndType("49000"); // 登録値 50000 より小さい
    await userEvent.click(screen.getByRole("button", { name: "返却場所を選択" }));
    expect(wasPosted()).toBe(false);
  });

  it("車両の登録値と同じ走行距離でも送信がブロックされる", async () => {
    mockEndpoints({ mileage: 50000 });
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    await selectVehicleAndType("50000"); // 同値（登録値より大きくない）
    await userEvent.click(screen.getByRole("button", { name: "返却場所を選択" }));
    expect(wasPosted()).toBe(false);
  });

  it("車両の登録値より大きい走行距離なら、そのまま日報を送って駐車画面に進む", async () => {
    mockEndpoints();
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    await selectVehicleAndType("50001");
    expect(await screen.findByRole("button", { name: "設定する" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "駐車場所" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "返却場所を選択" }));
    expect(await screen.findByRole("heading", { name: "駐車場所" })).toBeInTheDocument();
    expect(postedBody()).toMatchObject({ parkingPolicy: "post_submit_map", items: [{ courseId: "c1", cycleNo: 1 }] });
    expect(postedBody()).not.toHaveProperty("parking");
  });
});

describe("SubmitPageClientV2 — 車の置き場所", () => {
  beforeEach(() => mockApiFetch.mockReset());
  const parkBodies = () => mockApiFetch.mock.calls.filter(([url, init]) => url === "/api/reports/v2/parking" && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)));
  async function submitVehicle(label = "返却場所を選択") {
    await selectVehicleAndType("50001");
    await userEvent.click(screen.getByRole("button", { name: label }));
  }

  it("日報を保存してから現在地で候補を出す。選択を確認するまで記録も報酬表示もしない", async () => {
    mockEndpoints();
    locationMock.locate.mockResolvedValue({ lat: 34.78, lng: 135.47, accuracyM: 8, timestamp: Date.now() });
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    expect(locationMock.locate).not.toHaveBeenCalled();
    await submitVehicle();
    expect(await screen.findByRole("heading", { name: "駐車場所" })).toBeInTheDocument();
    for (const name of ["まだ使用中", "次の人に渡した", "あとで記録", "現在地を使う"]) expect(screen.queryByText(name)).not.toBeInTheDocument();
    expect(screen.queryByText(/日報は保存済みです。地図で/)).not.toBeInTheDocument();
    expect(screen.queryByText(/近くの登録場所が見つかりました/)).not.toBeInTheDocument();
    for (const label of ["位置情報：許可済み", "未選択", "近くの候補"]) expect(screen.queryByText(label)).not.toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "現在地" })).toBeVisible();
    expect(screen.getByTestId("parking-camera-target")).toHaveTextContent("34.78,135.47");
    expect(screen.queryByRole("group", { name: "駐車場所の候補" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "地図の中央にピンを置く" })).not.toBeInTheDocument();
    const suggestion = await screen.findByRole("button", { name: "地図で 豊中センター を選ぶ" });
    expect(screen.queryByRole("group", { name: "豊中センターの区画" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ここに返却" })).toBeDisabled();
    expect(suggestion).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("textbox", { name: "メモ（任意）" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "駐車場を検索" }));
    const input = screen.getByRole("searchbox", { name: "駐車場名" });
    expect(input).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.keyboard("京都");
    await userEvent.click(within(screen.getByRole("search")).getByRole("button", { name: "京都車庫" }));
    expect(screen.getByTestId("parking-camera-target")).toHaveTextContent("35.01,135.76");
    expect(screen.getByRole("button", { name: "ここに返却" })).toBeDisabled();
    await userEvent.click(suggestion);
    const toyonaka = screen.getByRole("dialog", { name: "区画を選ぶ" });
    expect(within(toyonaka).getByRole("button", { name: "A-1" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "B-1" })).not.toBeInTheDocument();
    await userEvent.click(within(toyonaka).getByRole("button", { name: "A-2" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(suggestion).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "ここに返却" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "メモ（任意）" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "区画を変更" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("豊中センター · A-2")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "地図で 京都車庫 を選ぶ" }));
    expect(screen.queryByRole("group", { name: "豊中センターの区画" })).not.toBeInTheDocument();
    const kyotoSlots = screen.getByRole("group", { name: "京都車庫の区画" });
    await userEvent.click(within(kyotoSlots).getByRole("button", { name: "B-1" }));
    await userEvent.click(suggestion);
    expect(screen.queryByRole("group", { name: "京都車庫の区画" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "A-2" })).toHaveAttribute("aria-pressed", "false");
    expect(parkBodies()).toHaveLength(0);
    expect(mockApiFetch.mock.calls.some(([url]) => String(url).includes("/api/me/submit-screen"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "A-1" }));
    await userEvent.click(screen.getByRole("button", { name: "ここに返却" }));
    await waitFor(() => expect(parkBodies()).toHaveLength(1));
    expect(parkBodies()[0]).toMatchObject({ receiptKey: postedBody().clientKey, parking: { vehicleId: "v1", status: "parked", placeId: "p1", slotId: "s1", coords: null } });
    expect(await screen.findByRole("heading", { name: "日報の送信が完了しました！" })).toBeInTheDocument();
  });

  it("手動で置いた返却ピンは、後から現在地を取得しても上書きせず、その座標を保存する", async () => {
    mockEndpoints();
    const fix = Promise.withResolvers<{ lat: number; lng: number; accuracyM: number; timestamp: number }>();
    locationMock.locate.mockReturnValue(fix.promise);
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    await submitVehicle();
    const pinButton = await screen.findByRole("button", { name: "地図にピンを置く" });
    await waitFor(() => expect(screen.getByTestId("parking-camera-target")).toHaveTextContent("35.01,135.76"));
    await userEvent.click(pinButton);
    expect(screen.getByText("地図のピン", { exact: true })).toBeVisible();

    await act(async () => fix.resolve({ lat: 34.78, lng: 135.47, accuracyM: 8, timestamp: Date.now() }));
    expect(screen.getByTestId("parking-camera-target")).toHaveTextContent("35.01,135.76");
    expect(screen.getByText("地図のピン", { exact: true })).toBeVisible();
    expect(parkBodies()).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "ここに返却" }));
    await waitFor(() => expect(parkBodies()).toHaveLength(1));
    expect(parkBodies()[0].parking).toMatchObject({ placeId: null, slotId: null, coords: { lat: 34.69, lng: 135.5 } });
  });

  it("StrictModeでも駐車画面への遷移で自動取得は一回だけ。許可ボタンを挟まない", async () => {
    mockEndpoints();
    locationMock.locate.mockResolvedValue({ lat: 34.78, lng: 135.47, accuracyM: 8, timestamp: Date.now() });
    render(<StrictMode><SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig></StrictMode>);
    expect(locationMock.locate).not.toHaveBeenCalled();
    await submitVehicle();
    expect(await screen.findByRole("button", { name: "地図で 豊中センター を選ぶ" })).toBeVisible();
    expect(locationMock.locate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "位置情報を許可" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ここに返却" })).toBeDisabled();
  });

  it("地図が使えない場合も登録済み駐車場から返却できる", async () => {
    mockEndpoints();
    mapMock.status = "unavailable";
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    await submitVehicle();
    await userEvent.click(await screen.findByRole("button", { name: "駐車場を検索" }));
    const alternatives = screen.getByRole("search", { name: "駐車場を検索" });
    await userEvent.click(within(alternatives).getByRole("button", { name: "京都車庫" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "B-1" }));
    await userEvent.click(screen.getByRole("button", { name: "ここに返却" }));
    await waitFor(() => expect(parkBodies()).toHaveLength(1));
    expect(parkBodies()[0].parking.placeId).toBe("p2");
  });

  it("月リースの場合は車両があっても地図やGPSを開かず、報酬へ進む", async () => {
    mockEndpoints({ monthly: true });
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    await submitVehicle("送信");
    expect(await screen.findByRole("heading", { name: "日報の送信が完了しました！" })).toBeInTheDocument();
    expect(locationMock.locate).not.toHaveBeenCalled();
    expect(parkBodies()).toHaveLength(0);
    expect(mockApiFetch.mock.calls.some(([url]) => String(url).includes("/api/reports/parking-places"))).toBe(false);
  });

  it("位置取得不可と駐車保存失敗では地図に記録を残し、日報を再送せず同じ値で再試行", async () => {
    mockEndpoints({ parkingFails: true });
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    await submitVehicle();
    expect(await screen.findByText(/現在地を確認できません/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "地図にピンを置く" }));
    await userEvent.click(screen.getByRole("button", { name: "ここに返却" }));
    expect(await screen.findByText("駐車場所を記録できませんでした")).toBeInTheDocument();
    expect(screen.getByText("地図のピンを選択中")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ここに返却" }));
    expect(await screen.findByRole("heading", { name: "日報の送信が完了しました！" })).toBeInTheDocument();
    expect(parkBodies()).toHaveLength(2);
    expect(parkBodies()[1]).toEqual(parkBodies()[0]);
    expect(mockApiFetch.mock.calls.filter(([url, init]) => url === "/api/reports/v2" && init?.method === "POST")).toHaveLength(1);
  });

  it("前日の日報保存後は現在地を読まず、駐車時刻を求める", async () => {
    mockEndpoints();
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    await userEvent.click(await screen.findByRole("button", { name: "前日を選ぶ" }));
    await submitVehicle();
    await userEvent.click(await screen.findByRole("button", { name: "地図にピンを置く" }));
    expect(locationMock.locate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ここに返却" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("駐車時刻"), { target: { value: "20:41" } });
    await userEvent.click(screen.getByRole("button", { name: "ここに返却" }));
    await waitFor(() => expect(parkBodies()).toHaveLength(1));
    expect(parkBodies()[0].parking.at).toBe("2026-11-23T20:41:00+09:00");
  });

  it("同じタブを再読み込みしたら保存済みの日報を再送せずに駐車記録へ戻る", async () => {
    mockEndpoints({ resume: { stage: "required", reportDate: "2026-11-24", vehicleId: "v-resumed" } });
    sessionStorage.setItem("hakotora-pwa-parking-receipt", "restored");
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    expect(await screen.findByRole("heading", { name: "駐車場所" })).toBeInTheDocument();
    expect(wasPosted()).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "地図にピンを置く" }));
    await userEvent.click(screen.getByRole("button", { name: "ここに返却" }));
    await waitFor(() => expect(parkBodies()).toHaveLength(1));
    expect(parkBodies()[0]).toMatchObject({ receiptKey: "restored", parking: { vehicleId: "v-resumed" } });
  });
});

describe("SubmitPageClientV2 — コースを追加", () => {
  beforeEach(() => mockApiFetch.mockReset());

  it("担当の追加候補だけをキーボードで選び、通常シフトと申請を区別して送信する", async () => {
    mockEndpoints({ candidates: [course, { ...course, cycleNo: 2, cycleLabel: "C2" }] });
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    const add = await screen.findByRole("button", { name: "コースを追加" });
    add.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("コースA C2")).toBeInTheDocument();
    expect(screen.queryByText("コースA C1")).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    const remove = await screen.findByRole("button", { name: "コースA C2の追加を取り消す" });
    expect(remove).toBeEnabled();
    expect(screen.queryByText("承認待ちの追加")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "コースを追加" })).not.toBeInTheDocument();

    await userEvent.click(remove);
    expect(remove).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "コースを追加" }));
    await userEvent.click(await screen.findByText("コースA C2"));
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(wasPosted()).toBe(true));
    expect(postedBody().items).toMatchObject([
      { courseId: "c1", cycleNo: 1, request: false },
      { courseId: "c1", cycleNo: 2, request: true },
    ]);
  });

  it("追加候補がゼロでも現在のシフト・送信は残す", async () => {
    mockEndpoints({ candidates: [course] });
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    expect(await screen.findByText("コースA")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "コースを追加" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送信" })).toBeEnabled();
  });
});

describe("SubmitPageClientV2 — 送信後の報酬取得", () => {
  beforeEach(() => mockApiFetch.mockReset());

  function pendingFetch() {
    let resolve!: (value: unknown) => void;
    const promise = new Promise<unknown>((r) => { resolve = r; });
    return { promise, resolve };
  }
  const amount = (todayReward: number) => ({ blocks: [
    { id: "greeting", type: "greeting", title: "日報を送信しました", message: "" },
    { id: "reward", type: "today_reward", todayReward },
  ] });
  const postCount = () => mockApiFetch.mock.calls.filter(([url, init]) => url === "/api/reports/v2" && init?.method === "POST").length;
  const rewardReads = () => mockApiFetch.mock.calls.filter(([url]) => url.startsWith("/api/me/submit-screen?"));

  async function submitFixture(mileage = "50001") {
    await selectVehicleAndType(mileage);
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
  }

  it("送信開始から同じ文言とバーで進み、取得後だけ実額と完了を表示する", async () => {
    const post = pendingFetch();
    const get = pendingFetch();
    mockEndpoints({ monthly: true, postReport: () => post.promise, postScreen: () => get.promise });
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    await submitFixture();
    const bar = screen.getByRole("progressbar", { name: "日報の処理状況" });
    expect(bar).toBeVisible();
    expect(bar).not.toHaveAttribute("aria-valuenow");
    const waitingText = screen.getByRole("status");
    expect(waitingText).toHaveTextContent(/^送信しています$/);
    expect(bar.firstElementChild).toHaveStyle("transform: scaleX(0.25)");
    expect(rewardReads()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "送信" })).not.toBeInTheDocument();
    expect(screen.queryByText(/¥0/)).not.toBeInTheDocument();

    await act(async () => post.resolve({ reportSaved: true, parkingStage: "not_required" }));
    expect(screen.getByRole("progressbar", { name: "日報の処理状況" })).toBe(bar);
    expect(screen.getByRole("status")).toBe(waitingText);
    expect(waitingText).toHaveTextContent(/^送信しています$/);
    expect(bar.firstElementChild).toHaveStyle("transform: scaleX(0.75)");
    expect(screen.queryByText(/画面を閉じず|日報は保存済み|報酬を確認しています/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "日報の送信が完了しました！" })).not.toBeInTheDocument();

    await act(async () => get.resolve(amount(12_000)));
    expect(screen.getByText("12,000円")).toBeVisible();
    expect(screen.getByRole("heading", { name: "日報の送信が完了しました！" })).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/^0円$/)).not.toBeInTheDocument();
    expect(postCount()).toBe(1);
  });

  it("日報の保存に失敗した場合は入力へ戻り、値と送信キーを保持する", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("日報の保存に失敗しました")).mockResolvedValueOnce({ reportSaved: true, parkingStage: "not_required" });
    mockEndpoints({ monthly: true, postReport: send, postScreen: () => Promise.resolve(amount(12_000)) });
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    await submitFixture();
    expect(await screen.findByText("日報の保存に失敗しました")).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/現在:/)).toHaveValue(50001);
    expect(rewardReads()).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "送信" }));
    expect(await screen.findByText("12,000円")).toBeVisible();
    const bodies = mockApiFetch.mock.calls.filter(([url, init]) => url === "/api/reports/v2" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
  });

  it("報酬の取得が失敗しても日報は保存済みと明示し、再取得だけで実際の0円を表示する", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(amount(0));
    mockEndpoints({ monthly: true, postScreen: load });
    render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
    await submitFixture();
    expect(screen.getByRole("alert")).toHaveTextContent("日報は保存済みですが、報酬の見込みを読み込めませんでした。");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "日報の送信が完了しました！" })).toBeVisible();
    expect(screen.queryByText("¥0")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "報酬を読み込み直す" }));
    expect(await screen.findByText("¥0")).toBeVisible();
    expect(postCount()).toBe(1);
    expect(rewardReads()).toHaveLength(2);
    expect(rewardReads()[0][0]).toBe(rewardReads()[1][0]);
  });

  it("タイムアウト後の遅延応答が再試行で表示した金額を上書きしない", async () => {
    const first = pendingFetch();
    const second = pendingFetch();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mockEndpoints({ monthly: true, postScreen: load });
    const timers = vi.spyOn(window, "setTimeout");
    try {
      render(<SWRConfig value={{ provider: () => new Map() }}><SubmitPageClientV2 /></SWRConfig>);
      await submitFixture();
      const timeout = timers.mock.calls.find(([, delay]) => delay === 20_000)?.[0];
      expect(timeout).toBeTypeOf("function");
      act(() => { (timeout as () => void)(); });
      expect(screen.getByRole("alert")).toHaveTextContent("日報は保存済み");
      expect(rewardReads()[0][1]?.signal?.aborted).toBe(true);
      await userEvent.click(screen.getByRole("button", { name: "報酬を読み込み直す" }));
      await act(async () => second.resolve(amount(8_000)));
      expect(screen.getByText("8,000円")).toBeVisible();
      await act(async () => first.resolve(amount(12_000)));
      expect(screen.queryByText("12,000円")).not.toBeInTheDocument();
      expect(screen.getByText("8,000円")).toBeVisible();
      expect(postCount()).toBe(1);
    } finally {
      timers.mockRestore();
    }
  });
});
