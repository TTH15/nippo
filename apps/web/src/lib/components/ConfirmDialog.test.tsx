import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("bodyへ表示し、キャンセルへ初期フォーカスを移してEscで閉じる", async () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="税区分を変更しますか？"
        message="契約上の扱いだけを変更します。"
        confirmLabel="税区分を変更"
        tone="neutral"
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("dialog", { name: "税区分を変更しますか？" })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    await waitFor(() => expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("確認ボタンで処理を実行して閉じる", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="確認"
        message="保存すると単価は0円になります。"
        confirmLabel="無効にする"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "無効にする" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
