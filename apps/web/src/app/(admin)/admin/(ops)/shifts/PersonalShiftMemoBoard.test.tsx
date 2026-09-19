import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PersonalShiftMemoBoard from "./PersonalShiftMemoBoard";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({ addresses: [] }), getStoredDriver: () => null }));
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
  localStorage.setItem(storageKey, JSON.stringify({ version: 1, lanes: [lane], assignments: { [key]: people, [nextKey]: people }, laneOrder: [lane.id] }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.removeItem(storageKey); });

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
