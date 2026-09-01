import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageExportDialog } from "./ImageExportDialog";
import type { DispatchImage } from "@/lib/captureDispatchImage";

const artifact: DispatchImage = { blob: new Blob(["png"], { type: "image/png" }), url: "data:image/png;base64,cG5n", width: 1224, height: 1800 };
const props = { title: "配車画像", filename: "dispatch_2026-08-31_all", pageCount: 2, onClose: () => {} };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("本番の画像共有", () => {
  it("生成後の明示操作でPNGを共有し、キャンセル後も保存できる", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError"));
    vi.stubGlobal("navigator", { share, canShare: () => true });
    render(<ImageExportDialog {...props} generate={async () => artifact} />);
    const button = await screen.findByRole("button", { name: "共有・写真に保存" });
    expect(share).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(share).toHaveBeenCalledTimes(1);
    const file = share.mock.calls[0][0].files[0] as File;
    expect(file.name).toBe("dispatch_2026-08-31_all_1.png");
    expect(file.type).toBe("image/png");
    await screen.findByText(/共有をキャンセルしました/);
    expect(screen.getByRole("link", { name: "画像をダウンロード" })).toBeInTheDocument();
  });
  it("2枚目を選べ、条件変更前の画像を別名で保存しない", async () => {
    vi.stubGlobal("navigator", {});
    const generate = vi.fn().mockResolvedValue(artifact);
    const view = render(<ImageExportDialog {...props} generate={generate} />);
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "次の画像" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "画像をダウンロード" })).toHaveAttribute("download", "dispatch_2026-08-31_all_2.png"));
    expect(generate).toHaveBeenLastCalledWith(1);
    const pending = () => new Promise<DispatchImage>(() => {});
    view.rerender(<ImageExportDialog {...props} filename="new-date" generate={pending} />);
    expect(screen.queryByRole("link", { name: "画像をダウンロード" })).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("生成失敗から再試行でき、共有非対応でも説明を増やさずPNGを保存できる", async () => {
    vi.stubGlobal("navigator", {});
    const generate = vi.fn().mockRejectedValueOnce(new Error("SVG failed")).mockResolvedValue(artifact);
    render(<ImageExportDialog {...props} generate={generate} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "もう一度作成する" }));
    await screen.findByRole("link", { name: "画像をダウンロード" });
    expect(screen.queryByRole("button", { name: "共有・写真に保存" })).toBeNull();
    expect(screen.queryByText(/画像を長押しして保存/)).toBeNull();
  });
});
