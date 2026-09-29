import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PersonalShiftMemoBoard from "./PersonalShiftMemoBoard";
import { exportShiftMemo } from "@/lib/shiftMemo/transfer";
import { apiUpload } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({ addresses: [] }), apiUpload: vi.fn(), getStoredDriver: () => null }));
const storageKey = "hakotora_personal_shift_memo_v1:required-count-test";
const key = "base-course|2026-09-01";
const nextKey = "base-course|2026-09-02";
const lane = { id: "base-course", routeId: "course", name: "豊中1", color: "#fbbf24", activeWeekdays: [1, 2, 3, 4, 5, 6], requiredCount: 2, custom: false };
const people = [{ placementId: "p1", personKey: "d1", driverId: "d1", name: "配置済み" }, { placementId: "p2", personKey: "d2", driverId: "d2", name: "配置済み2" }];
const props = { dates: ["2026-09-01", "2026-09-02"], courses: [{ id: "course", name: "豊中", color: "#fbbf24", max_drivers: 2 }], drivers: [{ id: "d3", name: "追加候補", display_name: "追加候補" }], today: "2026-09-01", storageNamespace: "required-count-test" };
const stored = () => JSON.parse(localStorage.getItem(storageKey)!);
const trigger = (count: number) => screen.getAllByRole("button", { name: `9月1日の豊中1の必要人数を変更（現在${count}人）` })[0];
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  localStorage.setItem(storageKey, JSON.stringify({ version: 1, lanes: [lane], assignments: { [key]: people, [nextKey]: people }, laneOrder: [lane.id] }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.removeItem(storageKey); });

it("別端末のメモを確認してから置き換え、読み込み前へ戻せる", async () => {
  render(<PersonalShiftMemoBoard {...props} />);
  await screen.findByText("この端末に自動保存済み");
  const received = { version: 1 as const,
    lanes: [{ ...lane, id: "received-lane", name: "受領した担当枠" }], laneOrder: ["received-lane"], hiddenLaneIds: [],
    assignments: { "received-lane|2026-09-01": [{ placementId: "received", personKey: "custom:応援", name: "応援" }] },
    extraPeople: ["応援"], notes: {}, dayOverrides: {}, requiredCountOverrides: {}, routeOrder: [], hiddenRouteIds: [],
    widths: { day: 76, lane: 190, detail: 330 },
  };
  const data = exportShiftMemo(received);
  const file = new File([data], "received.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => data });
  fireEvent.change(screen.getByLabelText("読み込むシフトメモを選ぶ"), { target: { files: [file] } });
  expect(await screen.findByRole("dialog", { name: "この端末のメモを置き換えますか？" })).toHaveTextContent("未登録の名前札 1人");
  expect(stored().lanes[0].name).toBe("豊中1");
  click("メモを読み込む");
  await waitFor(() => expect(stored().lanes[0].name).toBe("受領した担当枠"));
  expect(localStorage.getItem(`${storageKey}:before-import`)).not.toBeNull();
  click("読み込み前に戻す");
  fireEvent.click(within(screen.getByRole("dialog", { name: "読み込み前のメモに戻しますか？" })).getByRole("button", { name: "読み込み前に戻す" }));
  await waitFor(() => expect(stored().lanes[0].name).toBe("豊中1"));
  expect(localStorage.getItem(`${storageKey}:before-import`)).toBeNull();
});

it("PNGの読み取り結果は確認後に対象日へ入り、未登録者はメモ内だけに残る", async () => {
  vi.mocked(apiUpload).mockResolvedValueOnce({ period: { year: 2026, month: 9 },
    rows: [{ name: "豊中1", days: [{ day: 1, names: ["応援"] }] }], warnings: [] });
  render(<PersonalShiftMemoBoard {...props} />);
  await screen.findByText("この端末に自動保存済み");
  const file = new File(["sample"], "memo.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("読み込むシフトメモを選ぶ"), { target: { files: [file] } });
  const dialog = await screen.findByRole("dialog", { name: "読み取り結果を確認" });
  expect(dialog).toHaveTextContent("豊中1");
  expect(stored().assignments[key][0].name).toBe("配置済み");
  fireEvent.click(within(dialog).getByRole("button", { name: "メモに読み込む" }));
  await waitFor(() => expect(stored().assignments[key][0].name).toBe("応援"));
  expect(stored().assignments[key][0].driverId).toBeUndefined();
  expect(stored().extraPeople).toContain("応援");
});

it("旧メモへ日別人数を追加して再読込でき、通常へ戻しても配置・他の日・休みは変わらない", async () => {
  const first = render(<PersonalShiftMemoBoard {...props} />);
  fireEvent.click(await screen.findAllByRole("button", { name: /9月1日の豊中1の必要人数を変更/ }).then(buttons => buttons[0]));
  expect(screen.getByRole("dialog")).toHaveTextContent("通常:2人");
  expect(screen.getByRole("heading", { name: "9月1日（火）" })).toBeVisible();
  expect(screen.queryByText("この日だけの必要人数")).not.toBeInTheDocument();
  click("必要人数を増やす");
  await waitFor(() => expect(stored().requiredCountOverrides).toEqual({ [key]: 3 }));
  click("閉じる");
  expect(trigger(3)).toHaveTextContent("あと1");
  expect(screen.getAllByRole("button", { name: /9月2日の豊中1の必要人数を変更（現在2人）/ })[0]).toHaveTextContent("2/2");
  first.unmount();
  render(<PersonalShiftMemoBoard {...props} />);
  await waitFor(() => expect(trigger(3)).toBeVisible());
  click("9月1日の豊中1を休みにする");
  fireEvent.click(trigger(3)); // 休みの日は日別配置カードから開ける
  click("必要人数をリセット");
  await waitFor(() => expect(stored().requiredCountOverrides).toEqual({}));
  expect(stored().assignments).toEqual({ [key]: people, [nextKey]: people });
  expect(stored().dayOverrides).toEqual({ [key]: "off" });
  expect(stored().lanes[0].requiredCount).toBe(2);
});

it("名前を選択中でも人数ボタンのキー操作では配置せず、0人への変更も名前札を保持する", async () => {
  render(<PersonalShiftMemoBoard {...props} />);
  const button = await screen.findAllByRole("button", { name: /9月1日の豊中1の必要人数を変更/ }).then(buttons => buttons[0]);
  fireEvent.click(screen.getByText("追加候補").closest("button")!);
  fireEvent.keyDown(button, { key: " " });
  fireEvent.click(button);
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "必要人数を減らす" }));
  click("必要人数を減らす");
  expect(within(dialog).getByRole("button", { name: "必要人数を減らす" })).toBeDisabled();
  click("閉じる");
  expect(trigger(0)).toHaveTextContent("2/0");
  await waitFor(() => expect(stored().requiredCountOverrides[key]).toBe(0));
  expect(stored().assignments[key]).toEqual(people);
  expect(stored().dayOverrides).toEqual({});
});

it("増減を即時反映し、保存失敗でも値を保って再試行できる。Escapeでは戻さない", async () => {
  render(<PersonalShiftMemoBoard {...props} />);
  await waitFor(() => expect(screen.getByText("この端末に自動保存済み")).toBeVisible());
  fireEvent.click(trigger(2));
  click("必要人数を増やす");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(trigger(3)).toBeVisible();
  await waitFor(() => expect(stored().requiredCountOverrides[key]).toBe(3));
  const setter = vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => { throw new DOMException("full", "QuotaExceededError"); });
  fireEvent.click(trigger(3));
  click("必要人数を増やす");
  click("閉じる");
  expect(await screen.findByRole("alert")).toHaveTextContent("端末へ保存できませんでした");
  expect(trigger(4)).toHaveTextContent("あと2");
  expect(stored().requiredCountOverrides).toEqual({ [key]: 3 });
  setter.mockRestore();
  click("保存を再試行");
  await waitFor(() => expect(stored().requiredCountOverrides[key]).toBe(4));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
