import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ShiftFilters } from "./ShiftFilters";
import { initialDemo } from "./model";
import { initialShiftView } from "./navigation";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Harness() {
  const [view, setView] = useState(initialShiftView);
  return <ShiftFilters demo={initialDemo()} view={view} update={patch => setView(value => ({ ...value, ...patch }))} count={9}/>;
}
it("スマホでラベルを閉じても複数選択を保持し、すべてで解除できる", async () => {
  const original = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation(query => {
    const result = original(query);
    Object.defineProperty(result, "matches", { value: query === "(max-width: 767px)" });
    return result;
  });
  render(<Harness/>);
  const toggle = screen.getByRole("button", { name: "ラベルで絞り込む" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: "Amazon" })).toBeNull();
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Amazon" }));
  fireEvent.click(screen.getByRole("button", { name: "豊中" }));
  fireEvent.click(toggle);
  expect(toggle.textContent).toContain("Amazon ほか1件");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Amazon" })).toBeNull());
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "Amazon" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "すべて" }));
  expect(toggle.textContent).toContain("すべて");
});
