import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditorModal } from "./EditorModal";
it("通常の編集モーダルは従来どおりEscapeと閉じるボタンで閉じられる", () => {
  const close = vi.fn();
  render(<EditorModal title="編集" onClose={close}><input aria-label="名前" /></EditorModal>);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "編集を閉じる" }));
  expect(close).toHaveBeenCalledTimes(2);
});
