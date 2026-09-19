import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReflectShiftMemoDialog } from "./ReflectShiftMemoDialog";
import { apiFetch } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const lane = { id: "base-course", routeId: "course", name: "豊中", activeWeekdays: [1, 2, 3, 4, 5, 6] };
const props = { dates: ["2026-09-16"], courses: [{ id: "course", name: "豊中" }], drivers: [{ id: "driver", name: "佐藤" }], lanes: [lane], assignments: { "base-course|2026-09-16": [{ personKey: "driver", driverId: "driver", name: "佐藤" }] }, dayOverrides: {}, onClose: vi.fn(), onApplied: vi.fn().mockResolvedValue(undefined) };
const result = { revision: "a".repeat(32), changes: [{ date: "2026-09-16", courseId: "course", cycleNo: 0, addIds: ["driver"], removeIds: [], keepIds: [] }], warnings: [], added: 1, removed: 0, kept: 0, applied: false };
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
beforeEach(() => { vi.mocked(apiFetch).mockReset().mockResolvedValue(result); props.onApplied.mockClear(); props.onClose.mockClear(); });
afterEach(cleanup);

it("差分の確認と最終確定を分け、キャンセルでは本番へ書き込まない", async () => {
  render(<ReflectShiftMemoDialog {...props}/>);
  expect(screen.getByRole("button", { name: "変更内容を確認" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "豊中" }));
  click("変更内容を確認");
  await screen.findByText("追加：佐藤");
  expect(JSON.parse(vi.mocked(apiFetch).mock.calls[0][1]!.body as string).action).toBe("preview");
  click("この内容で反映"); click("キャンセル");
  expect(apiFetch).toHaveBeenCalledTimes(1);
  click("この内容で反映"); click("シフトへ反映する");
  await screen.findByText("シフト表で確認できます。メモはそのまま残っています。");
  const body = JSON.parse(vi.mocked(apiFetch).mock.calls[1][1]!.body as string);
  expect(body).toMatchObject({ action: "apply", revision: result.revision, mode: "add" });
  expect(props.onApplied).toHaveBeenCalledTimes(1);
});
it("反映失敗で入力を保持し、差分を再確認するまで再送しない", async () => {
  render(<ReflectShiftMemoDialog {...props}/>);
  fireEvent.click(screen.getByRole("checkbox", { name: "豊中" })); click("変更内容を確認");
  await screen.findByText("追加：佐藤");
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error("別の変更が保存されています。"));
  click("この内容で反映"); click("シフトへ反映する");
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("別の変更"));
  expect(screen.getByRole("checkbox", { name: "豊中" })).toBeChecked();
  expect(screen.queryByRole("button", { name: "この内容で反映" })).not.toBeInTheDocument();
  expect(props.onApplied).not.toHaveBeenCalled();
  click("変更内容を確認"); await screen.findByText("追加：佐藤");
  expect(JSON.parse(vi.mocked(apiFetch).mock.calls[2][1]!.body as string).action).toBe("preview");
});
it("反映後の再読込失敗を保存失敗にせず、再読込だけを再試行する", async () => {
  props.onApplied.mockRejectedValueOnce(new Error("offline"));
  render(<ReflectShiftMemoDialog {...props}/>);
  fireEvent.click(screen.getByRole("checkbox", { name: "豊中" })); click("変更内容を確認");
  await screen.findByText("追加：佐藤"); click("この内容で反映"); click("シフトへ反映する");
  await screen.findByRole("button", { name: "シフト表を再読込" });
  click("シフト表を再読込");
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(apiFetch).toHaveBeenCalledTimes(2);
  expect(props.onApplied).toHaveBeenCalledTimes(2);
});
