import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParkingLocationField } from "./ParkingLocationField";
import { ParkingPlacesEditor } from "./ParkingPlacesEditor";
import { initialDemo } from "./model";
import { searchParkingAddresses, type ParkingLocation } from "./parking-geocoding";

vi.mock("./mapbox-config", () => ({ PREVIEW_MAPBOX_ENABLED: true, PREVIEW_MAPBOX_TOKEN: "pk.test" }));
vi.mock("./parking-geocoding", async importOriginal => ({ ...await importOriginal<typeof import("./parking-geocoding")>(), searchParkingAddresses: vi.fn() }));
vi.mock("./ParkingMap", () => ({ ParkingMap: ({ onChange }: { onChange: (p: { lat: number; lng: number }) => void }) => <button type="button" onClick={() => onChange({ lat: 34.7801, lng: 135.4601 })}>テスト用にピンを移動</button> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const hit = { id: "a", address: "大阪府豊中市中桜塚", lat: 34.78, lng: 135.46 };
const search = vi.mocked(searchParkingAddresses);
function FieldHarness() {
  const [value, setValue] = useState<ParkingLocation>({ address: "" });
  return <ParkingLocationField value={value} onChange={setValue}/>;
}
function EditorHarness() {
  const [demo, setDemo] = useState(initialDemo);
  return <ParkingPlacesEditor demo={demo} setDemo={setDemo} notify={() => {}} confirm={(_, __, action) => action()} onClose={() => {}} onDirtyChange={() => {}}/>;
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const typeAddress = (value: string) => fireEvent.change(screen.getByRole("textbox", { name: "駐車場所の住所" }), { target: { value } });
describe("駐車場所の住所検索とピン編集", () => {
  it("入力中には送信せず、検索して候補を選んだ後の住所変更で古い位置を解除する", async () => {
    search.mockResolvedValue([hit]); render(<FieldHarness/>);
    typeAddress("豊中市"); expect(search).not.toHaveBeenCalled();
    click("住所を検索"); await screen.findByRole("button", { name: hit.address }); click(hit.address);
    expect(screen.getByLabelText("ピンの座標").textContent).toBe("34.780000, 135.460000");
    await screen.findByRole("button", { name: "テスト用にピンを移動" }); click("テスト用にピンを移動");
    expect(screen.getByLabelText("ピンの座標").textContent).toBe("34.780100, 135.460100");
    typeAddress("吹田市"); expect(screen.queryByLabelText("ピンの座標")).toBeNull();
  });
  it("住所を変えた後に届いた古い検索結果を表示しない", async () => {
    let finish!: (value: typeof hit[]) => void;
    search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<FieldHarness/>); typeAddress("豊中市"); click("住所を検索");
    const signal = search.mock.calls[0][1];
    typeAddress("吹田市"); expect(signal.aborted).toBe(true);
    await act(async () => finish([hit]));
    expect(screen.queryByRole("button", { name: hit.address })).toBeNull();
  });
  it("検索の0件と通信失敗を区別し、入力を残して再検索できる", async () => {
    search.mockResolvedValueOnce([]).mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce([hit]);
    render(<FieldHarness/>); typeAddress("豊中市"); click("住所を検索");
    await screen.findByText(/住所が見つかりません/); click("住所を検索");
    await screen.findByText(/通信状態を確認して再検索/); click("住所を検索");
    expect(await screen.findByRole("button", { name: hit.address })).toBeTruthy();
  });
  it("検索・微調整した位置と住所を保存し、名前だけの変更でも位置を維持する", async () => {
    search.mockResolvedValue([hit]); render(<EditorHarness/>);
    fireEvent.change(screen.getByRole("textbox", { name: "駐車場所の名前" }), { target: { value: "地図の車庫" } });
    typeAddress("豊中市"); click("住所を検索"); await screen.findByRole("button", { name: hit.address }); click(hit.address);
    await screen.findByRole("button", { name: "テスト用にピンを移動" }); click("テスト用にピンを移動"); click("駐車場所を追加");
    expect(within(screen.getByLabelText("登録済みの駐車場所")).getByText(hit.address)).toBeTruthy();
    click("地図の車庫を編集");
    expect(screen.getByLabelText("ピンの座標").textContent).toBe("34.780100, 135.460100");
    fireEvent.change(screen.getByRole("textbox", { name: "駐車場所の名前" }), { target: { value: "地図の車庫2" } }); click("変更を保存"); click("地図の車庫2を編集");
    expect(screen.getByLabelText("ピンの座標").textContent).toBe("34.780100, 135.460100");
    typeAddress("新しい住所"); click("変更を保存");
    expect(screen.getByRole("alert").textContent).toContain("位置を指定");
  });
});
