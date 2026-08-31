import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShiftExportDialog } from "./ShiftExportDialog";
import { renderDayImage, type ImageArtifact } from "./shiftImage";
import { initialDemo } from "./model";
import { initialShiftView } from "./navigation";

vi.mock("./shiftImage", async importOriginal => ({ ...await importOriginal<typeof import("./shiftImage")>(), renderDayImage: vi.fn() }));
const artifact: ImageArtifact = { blob: new Blob(["mock-png"], { type: "image/png" }), url: "data:image/png;base64,bW9jaw==", width: 1170, height: 3000 };
const open = () => render(<ShiftExportDialog demo={initialDemo()} view={{ ...initialShiftView(), dayFilter: "all" }} date="2026-09-01" onClose={() => {}}/>);
beforeEach(() => { vi.mocked(renderDayImage).mockReset().mockResolvedValue(artifact); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("画像の共有と保存", () => {
  it("生成したPNGファイルをクリック時に共有し、キャンセル後も保存できる", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { share, canShare });
    open();
    const button = await screen.findByRole("button", { name: "共有・写真に保存" });
    expect(share).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(share).toHaveBeenCalledTimes(1);
    const file = share.mock.calls[0][0].files[0] as File;
    expect(file.name).toBe("dispatch_2026-09-01_all.png"); expect(file.type).toBe("image/png");
    expect(canShare).toHaveBeenCalledWith({ files: [file] });
    await screen.findByText("共有をキャンセルしました。画像はこのまま保存できます。");
    expect(screen.getByRole("link", { name: "画像をダウンロード" })).toBeTruthy();
  });
  it("共有非対応なら長押し保存とダウンロードを案内する", async () => {
    vi.stubGlobal("navigator", {});
    open();
    const link = await screen.findByRole("link", { name: "画像をダウンロード" });
    expect(link.getAttribute("download")).toBe("dispatch_2026-09-01_all.png");
    expect(screen.queryByRole("button", { name: "共有・写真に保存" })).toBeNull();
    expect(screen.getByText(/共有メニュー非対応/)).toBeTruthy();
  });
  it("共有拒否では自動送信や再試行せず、保存手段を残す", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    vi.stubGlobal("navigator", { share, canShare: () => true });
    open(); fireEvent.click(await screen.findByRole("button", { name: "共有・写真に保存" }));
    await screen.findByText(/共有メニューを開けませんでした/);
    expect(share).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "画像をダウンロード" })).toBeTruthy();
  });
  it("素材の読み込み失敗から明示的に再生成できる", async () => {
    vi.mocked(renderDayImage).mockRejectedValueOnce(new Error("SVG failed"));
    open(); await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: "画像をダウンロード" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "もう一度作成する" }));
    await screen.findByRole("img");
  });
  it("条件変更前の遅い生成結果で新しい画像を上書きしない", async () => {
    let finishOld!: (result: ImageArtifact) => void;
    vi.mocked(renderDayImage).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    open();
    fireEvent.click(screen.getByRole("button", { name: /^稼働/ }));
    await screen.findByRole("img");
    finishOld({ ...artifact, url: "data:image/png;base64,old" });
    await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).toBe(artifact.url));
    expect(screen.getByRole("link", { name: "画像をダウンロード" }).getAttribute("download")).toContain("working");
  });
  it("絞り込み結果が空なら生成・共有しない", () => {
    render(<ShiftExportDialog demo={initialDemo()} view={{ ...initialShiftView(), query: "該当なし" }} date="2026-09-01" onClose={() => {}}/>);
    expect(screen.getByText(/画像にするドライバーがいません/)).toBeTruthy();
    expect(renderDayImage).not.toHaveBeenCalled();
  });
  it("10人を超えたら画像を分け、選択中の画像番号を保存名へ反映する", async () => {
    const demo = initialDemo();
    demo.drivers.push(...demo.drivers.slice(0, 2).map(driver => ({ ...driver, id: "extra-" + driver.id })));
    render(<ShiftExportDialog demo={demo} view={{ ...initialShiftView(), dayFilter: "all" }} date="2026-09-01" onClose={() => {}}/>);
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "次の画像" }));
    await screen.findByRole("img");
    expect(screen.getByRole("link", { name: "画像をダウンロード" }).getAttribute("download")).toBe("dispatch_2026-09-01_all_2.png");
    expect(vi.mocked(renderDayImage).mock.calls.at(-1)?.[1]).toBe(1);
  });
  it("画面の未割当タブを初期選択し、画像内の対象と保存名を揃える", async () => {
    render(<ShiftExportDialog demo={initialDemo()} view={{ ...initialShiftView(), dayFilter: "unassigned" }} date="2026-09-01" onClose={() => {}}/>);
    await screen.findByRole("img");
    expect(screen.getByRole("button", { name: /^未割当\s*2$/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "画像をダウンロード" }).getAttribute("download")).toBe("dispatch_2026-09-01_unassigned.png");
    expect(vi.mocked(renderDayImage).mock.calls.at(-1)?.[0].rows.map(row => row.id)).toEqual(["tanaka", "kobayashi"]);
    fireEvent.click(screen.getByRole("button", { name: /^全員\s*9$/ }));
    await screen.findByRole("img");
    expect(vi.mocked(renderDayImage).mock.calls.at(-1)?.[0].rows).toHaveLength(9);
  });

});
