import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSmsResendCooldown } from "./useSmsResendCooldown";
function Form() {
  const cooldown = useSmsResendCooldown();
  return <><button disabled={cooldown.seconds > 0} onClick={cooldown.start}>送信</button><output>{cooldown.seconds}</output></>;
}
beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); sessionStorage.clear(); });
it("送信後59秒では再送不可。60秒後に解除し、再送で60秒へ戻る", () => {
  render(<Form />); const send = screen.getByRole("button", { name: "送信" });
  fireEvent.click(send); expect(send).toBeDisabled(); expect(screen.getByRole("status")).toHaveTextContent("60");
  act(() => vi.advanceTimersByTime(59_000)); expect(send).toBeDisabled(); expect(screen.getByRole("status")).toHaveTextContent("1");
  act(() => vi.advanceTimersByTime(1000)); expect(send).toBeEnabled();
  fireEvent.click(send); expect(send).toBeDisabled(); expect(screen.getByRole("status")).toHaveTextContent("60");
});
it("ページを開き直しても残り時間を保持し、期限後は解除する", () => {
  const first = render(<Form />); fireEvent.click(screen.getByRole("button", { name: "送信" }));
  act(() => vi.advanceTimersByTime(25_000)); first.unmount(); render(<Form />);
  expect(screen.getByRole("status")).toHaveTextContent("35"); expect(screen.getByRole("button")).toBeDisabled();
  act(() => vi.advanceTimersByTime(35_000)); expect(screen.getByRole("button")).toBeEnabled();
});
it("バックグラウンドで時計が進んでも実時刻から残り時間を計算する", () => {
  render(<Form />); fireEvent.click(screen.getByRole("button", { name: "送信" }));
  vi.setSystemTime(new Date("2026-10-13T12:01:30Z"));
  act(() => vi.advanceTimersByTime(1000)); expect(screen.getByRole("button")).toBeEnabled();
});
