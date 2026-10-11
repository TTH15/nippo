import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PersonalShiftMemoBoard from "./PersonalShiftMemoBoard";
import { exportShiftMemo } from "@/lib/shiftMemo/transfer";
import { apiFetch, apiUpload } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn().mockResolvedValue({ addresses: [] }), apiUpload: vi.fn(), getStoredDriver: () => null }));
import { applyBoardChanges, type BoardChange } from "@/lib/shiftMemo/sharedBoardSync";
const presence = vi.hoisted(() => ({ connected: true, announce: vi.fn(), cells: {} as Record<string, { id: string; key: string | null; name: string; color: string }[]> }));
vi.mock("@/lib/realtime/cellCursors", () => ({ useCellCursors: (opts: { enabled?: boolean }) => ({ connected: !!opts.enabled && presence.connected, peers: [], cellPeers: presence.cells, reportCell: vi.fn(), announceRevision: presence.announce }) }));
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

// 遅延を制御し、本体の入力・保存・pending通知まで通す。
describe("共有メモの保存と同期", () => {
  const board = (notes: Record<string, string> = {}) => ({ version: 1, lanes: [lane], laneOrder: [lane.id], hiddenLaneIds: [], routeOrder: [], hiddenRouteIds: [], assignments: {} as Record<string, typeof people>, extraPeople: [] as string[], hiddenPeople: {} as Record<string, true>, notes, dayOverrides: {}, requiredCountOverrides: {}, widths: { day: 76, lane: 190, detail: 330 } });
  type Reply = { board: ReturnType<typeof board>; revision: number };
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (value: Error) => void;
    const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
  };
  let canonical: Reply;
  let pending: ReturnType<typeof vi.fn<(pending: boolean) => void>>;
  let get: () => Promise<Reply>;
  let patch: (body: { changes: BoardChange[] }) => Promise<Reply>;
  const api = vi.mocked(apiFetch);
  const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
  const patches = () => api.mock.calls.filter(([, options]) => options?.method === "PATCH");
  const gets = () => api.mock.calls.filter(([path, options]) => path === "/api/admin/shifts/memo/board" && !options?.method);
  const input = () => screen.getByRole("textbox", { name: "この日のメモ" });
  const edit = (value: string) => fireEvent.change(input(), { target: { value } });
  const mount = async () => { const result = render(<PersonalShiftMemoBoard {...props} mode="shared" onPendingChange={pending} />); await flush(); return result; };
  beforeEach(() => {
    vi.useFakeTimers(); sessionStorage.clear(); api.mockClear(); presence.announce.mockClear(); presence.connected = true; presence.cells = {};
    canonical = { board: board(), revision: 1 }; pending = vi.fn();
    get = async () => canonical;
    patch = async body => { canonical = { board: applyBoardChanges(canonical.board, body.changes) as ReturnType<typeof board>, revision: canonical.revision + 1 }; return canonical; };
    api.mockImplementation(async (path, options) => {
      if (path !== "/api/admin/shifts/memo/board") return { addresses: [] } as never;
      return (options?.method === "PATCH" ? patch(JSON.parse(String(options.body))) : get()) as never;
    });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); sessionStorage.clear(); });

  it("coursesやpendingコールバックの更新では初期取得を繰り返さず入力を保持する", async () => {
    const result = await mount();
    edit("未保存の入力");
    result.rerender(<PersonalShiftMemoBoard {...props} courses={props.courses.map(course => ({ ...course, name: "更新後" }))} mode="shared" onPendingChange={value => pending(value)} />);
    await flush();
    expect(input()).toHaveValue("未保存の入力"); expect(gets()).toHaveLength(1);
    await flush(400);
    expect(patches()).toHaveLength(1); expect(pending).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("status")).toHaveTextContent("同期済み");
  });

  it("保存中の追加編集を次の保存へ送り最後のpendingを解消する", async () => {
    const first = deferred<Reply>(); patch = () => first.promise;
    await mount(); edit("送信時"); await flush(400);
    expect(screen.getByRole("status")).toHaveTextContent("保存中");
    edit("追加編集");
    canonical = { board: board({ "2026-09-01": "送信時" }), revision: 2 };
    await act(async () => first.resolve(canonical));
    expect(input()).toHaveValue("追加編集"); expect(pending).toHaveBeenLastCalledWith(true);
    patch = async body => ({ board: applyBoardChanges(canonical.board, body.changes) as ReturnType<typeof board>, revision: 3 });
    await flush(400);
    expect(JSON.parse(String(patches()[1][1]?.body)).changes).toEqual([{ field: "notes", key: "2026-09-01", expected: "送信時", value: "追加編集" }]);
    expect(pending).toHaveBeenLastCalledWith(false); expect(screen.getByRole("status")).toHaveTextContent("同期済み");
  });

  it("GET r3→遅いPATCH r2でも別セルと追加編集が残り版が巻き戻らない", async () => {
    const slowGet = deferred<Reply>(); const slowPatch = deferred<Reply>();
    await mount(); get = () => slowGet.promise;
    fireEvent.click(screen.getByRole("button", { name: "更新" })); await flush();
    patch = () => slowPatch.promise;
    edit("送信"); await flush(400); edit("追加");
    await act(async () => slowGet.resolve({ board: board({ "2026-09-01": "送信", "2026-09-02": "別セル" }), revision: 3 }));
    await act(async () => slowPatch.resolve({ board: board({ "2026-09-01": "送信" }), revision: 2 }));
    expect(input()).toHaveValue("追加"); expect(presence.announce).toHaveBeenLastCalledWith(3);
    expect(sessionStorage.getItem("hakotora_shared_shift_memo_draft_v1:required-count-test")).toContain("別セル");
    patch = async body => ({ board: applyBoardChanges(board({ "2026-09-01": "送信", "2026-09-02": "別セル" }), body.changes) as ReturnType<typeof board>, revision: 4 });
    await flush(400); expect(pending).toHaveBeenLastCalledWith(false);
    expect(JSON.parse(String(patches()[1][1]?.body)).changes).toHaveLength(1);
  });

  it("保存後の通信失敗はGETで照合し重複送信せず同期済みになる", async () => {
    await mount(); patch = async body => { canonical = { board: applyBoardChanges(canonical.board, body.changes) as ReturnType<typeof board>, revision: 2 }; throw new Error("応答喪失"); };
    edit("実際は保存済み"); await flush(400);
    expect(gets()).toHaveLength(2); expect(patches()).toHaveLength(1);
    expect(input()).toHaveValue("実際は保存済み"); expect(pending).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("同値へ収束したGETは競合もPATCHもなくpendingを解消する", async () => {
    await mount(); edit("同じ変更"); canonical = { board: board({ "2026-09-01": "同じ変更" }), revision: 2 };
    fireEvent.click(screen.getByRole("button", { name: "更新" })); await flush(400);
    expect(patches()).toHaveLength(0); expect(pending).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("真の競合は入力と両方の値を保持し、再取得後も選択するまで保存しない", async () => {
    await mount(); edit("自分のメモ"); canonical = { board: board({ "2026-09-01": "他のメモ" }), revision: 2 };
    fireEvent.click(screen.getByRole("button", { name: "更新" })); await flush(1000);
    expect(input()).toHaveValue("自分のメモ"); expect(patches()).toHaveLength(0);
    expect(screen.getByRole("region", { name: "共有メモの変更を確認" })).toHaveTextContent("他のメモ");
    fireEvent.click(screen.getByRole("button", { name: "更新" })); await flush(1000);
    expect(screen.getByRole("alert")).toBeVisible(); expect(patches()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "自分の変更を保存" })); await flush(400);
    expect(JSON.parse(String(patches()[0][1]?.body)).changes[0].expected).toBe("他のメモ");
    expect(pending).toHaveBeenLastCalledWith(false); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("接続中の通知欠落、focus、online、再接続から再取得する", async () => {
    const result = await mount(); canonical = { board: board({ "2026-09-01": "通知なし" }), revision: 2 };
    await flush(15000); expect(input()).toHaveValue("通知なし");
    canonical = { board: board({ "2026-09-01": "focus復旧" }), revision: 3 };
    fireEvent(window, new Event("focus")); await flush(); expect(input()).toHaveValue("focus復旧");
    canonical = { board: board({ "2026-09-01": "online復旧" }), revision: 4 };
    fireEvent(window, new Event("online")); await flush(); expect(input()).toHaveValue("online復旧");
    presence.connected = false; result.rerender(<PersonalShiftMemoBoard {...props} mode="shared" onPendingChange={pending} />); await flush();
    expect(screen.getByRole("status")).toHaveTextContent("再接続中");
    canonical = { board: board({ "2026-09-01": "再接続復旧" }), revision: 5 };
    presence.connected = true; presence.cells = {}; result.rerender(<PersonalShiftMemoBoard {...props} mode="shared" onPendingChange={pending} />); await flush();
    expect(input()).toHaveValue("再接続復旧");
  });

  it("古いセッションの遅いPATCHは新しい盤面とpendingに反映しない", async () => {
    const stale = deferred<Reply>(); patch = () => stale.promise;
    const result = await mount(); edit("古い送信"); await flush(400);
    canonical = { board: board({ "2026-09-01": "新セッション" }), revision: 9 };
    result.rerender(<PersonalShiftMemoBoard {...props} storageNamespace="new-session" mode="shared" onPendingChange={pending} />); await flush();
    await act(async () => stale.resolve({ board: board({ "2026-09-01": "古い送信" }), revision: 2 }));
    expect(input()).toHaveValue("新セッション"); expect(pending).toHaveBeenLastCalledWith(false);
    expect(presence.announce).not.toHaveBeenCalledWith(2);
  });

  it("未保存の入力をリロード相当の再マウントで復元し正本と照合する", async () => {
    const result = await mount(); edit("端末に退避"); result.unmount();
    await mount(); expect(input()).toHaveValue("端末に退避");
    await flush(400); expect(patches()).toHaveLength(1); expect(pending).toHaveBeenLastCalledWith(false);
    expect(sessionStorage.getItem("hakotora_shared_shift_memo_draft_v1:required-count-test")).toBeNull();
  });
  it("候補をタップで隠して永続化し、日付変更・再入場後に戻せる。配置済みは保持する", async () => {
    canonical.board.assignments = { [key]: [{ placementId: "p3", personKey: "driver:d3", driverId: "d3", name: "追加候補" }] };
    const result = await mount();
    fireEvent.click(within(screen.getByRole("region", { name: "候補の名前札" })).getByRole("button", { name: "追加候補" }));
    fireEvent.click(screen.getByRole("button", { name: "追加候補を非表示にする" }));
    await flush(80);
    expect(canonical.board.hiddenPeople).toEqual({ "driver:d3": true });
    expect(canonical.board.assignments[key]).toHaveLength(1);
    expect(JSON.parse(String(patches()[0][1]?.body)).changes).toEqual([{ field: "hiddenPeople", key: "driver:d3", expected: null, value: true }]);
    fireEvent.click(screen.getByRole("button", { name: /非表示にする.*[01]人/ })); await flush(300);
    expect(screen.getByRole("button", { name: "追加候補を名前札に戻す" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^2日/ }));
    expect(screen.getByRole("button", { name: "追加候補を名前札に戻す" })).toBeVisible();
    result.unmount(); await mount();
    fireEvent.click(screen.getByRole("button", { name: /非表示にする.*1人/ })); await flush(300);
    fireEvent.click(screen.getByRole("button", { name: "追加候補を名前札に戻す" })); await flush(80);
    expect(canonical.board.hiddenPeople).toEqual({});
    expect(canonical.board.assignments[key]).toHaveLength(1);
    expect(pending).toHaveBeenLastCalledWith(false);
    expect(screen.getByText("非表示の名前札はありません")).toBeVisible();
  });

  it("配置済み札を非表示先へドロップしても配置を外さず、別の候補の同時非表示を保つ", async () => {
    canonical.board.assignments = { [key]: [{ placementId: "p3", personKey: "driver:d3", driverId: "d3", name: "追加候補" }] };
    await mount();
    fireEvent.drop(screen.getByRole("button", { name: /非表示にする.*0人/ }).parentElement!, { dataTransfer: { getData: () => JSON.stringify({ personKey: "driver:d3", name: "追加候補", sourceKey: key, placementId: "p3" }) } });
    canonical = { board: { ...canonical.board, hiddenPeople: { "driver:other": true } }, revision: 2 };
    fireEvent.click(screen.getByRole("button", { name: "更新" })); await flush(80);
    expect(canonical.board.hiddenPeople).toEqual({ "driver:d3": true, "driver:other": true });
    expect(canonical.board.assignments[key]).toHaveLength(1);
    expect(JSON.parse(String(patches()[0][1]?.body)).changes).toHaveLength(1);
  });

  it("閲覧者は非表示一覧を確認できるが、復元もドロップ保存もできない", async () => {
    canonical.board.hiddenPeople = { "driver:d3": true };
    render(<PersonalShiftMemoBoard {...props} mode="shared" canEdit={false} onPendingChange={pending} />); await flush();
    fireEvent.click(screen.getByRole("button", { name: /非表示にする.*1人/ })); await flush(300);
    expect(screen.getByRole("button", { name: "追加候補を名前札に戻す" })).toBeDisabled();
    fireEvent.drop(screen.getByRole("button", { name: /非表示にする.*1人/ }).parentElement!, { dataTransfer: { getData: () => JSON.stringify({ personKey: "driver:d3", name: "追加候補" }) } });
    await flush(1000); expect(patches()).toHaveLength(0);
  });

  it("古い初期GETは新しいセッションの盤面に反映しない", async () => {
    const stale = deferred<Reply>(); get = () => stale.promise;
    const result = await mount();
    canonical = { board: board({ "2026-09-01": "新しい初期値" }), revision: 10 }; get = async () => canonical;
    result.rerender(<PersonalShiftMemoBoard {...props} storageNamespace="new-get" mode="shared" onPendingChange={pending} />); await flush();
    await act(async () => stale.resolve({ board: board({ "2026-09-01": "古い初期値" }), revision: 1 }));
    expect(input()).toHaveValue("新しい初期値"); expect(pending).toHaveBeenLastCalledWith(false);
  });

  it("保存と照合GETが両方失敗したら未同期のまま再送を止め、onlineで復旧する", async () => {
    await mount(); patch = async () => { throw Error("offline"); }; get = async () => { throw Error("offline"); };
    edit("消えない入力"); await flush(1000);
    expect(patches()).toHaveLength(1); expect(pending).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("alert")).toHaveTextContent("入力は残っています");
    patch = async body => ({ board: applyBoardChanges(canonical.board, body.changes) as ReturnType<typeof board>, revision: 2 });
    get = async () => canonical; fireEvent(window, new Event("online")); await flush(400);
    expect(input()).toHaveValue("消えない入力"); expect(patches()).toHaveLength(2); expect(pending).toHaveBeenLastCalledWith(false);
  });

  it("notesの同時編集者を複数表示する", async () => {
    presence.cells = { "notes:2026-09-01": [{ id: "a", key: "notes:2026-09-01", name: "甲", color: "red" }, { id: "b", key: "notes:2026-09-01", name: "乙", color: "blue" }] };
    await mount(); expect(screen.getByText("甲が編集中")).toBeVisible(); expect(screen.getByText("乙が編集中")).toBeVisible();
  });

  it("人員移動の片側が競合したら両セルを保持し、明示解決後だけまとめて保存する", async () => {
    canonical.board.assignments = { [key]: people, [nextKey]: [] };
    await mount();
    const target = document.querySelector(`[data-shared-cell="${nextKey}"]`)!;
    fireEvent.drop(target, { dataTransfer: { getData: () => JSON.stringify({ personKey: "d1", driverId: "d1", name: "配置済み", sourceKey: key, placementId: "p1" }) } });
    canonical = { board: { ...canonical.board, assignments: { [key]: people, [nextKey]: [{ placementId: "remote", personKey: "remote", driverId: "remote", name: "他の人" }] } }, revision: 2 };
    fireEvent.click(screen.getByRole("button", { name: "更新" })); await flush(1000);
    expect(patches()).toHaveLength(0);
    const draft = JSON.parse(sessionStorage.getItem("hakotora_shared_shift_memo_draft_v1:required-count-test")!);
    expect(draft.local.assignments[key].map((person: { placementId: string }) => person.placementId)).toEqual(["p2"]);
    expect(draft.local.assignments[nextKey][0].name).toBe("配置済み");
    fireEvent.click(screen.getByRole("button", { name: "自分の変更を保存" })); await flush(80);
    expect(JSON.parse(String(patches()[0][1]?.body)).changes.map((change: BoardChange) => change.key).sort()).toEqual([key, nextKey].sort());
    expect(pending).toHaveBeenLastCalledWith(false);
  });

  it("短い保存待ちは控えめ、長い待ちは明示し、楽観更新と追加編集を維持する", async () => {
    const slow = deferred<Reply>(); patch = () => slow.promise;
    await mount(); edit("送信値"); await flush(400);
    expect(screen.getByRole("status")).toHaveTextContent("保存中"); expect(input()).toBeEnabled();
    await flush(8000);
    expect(screen.getByRole("status")).toHaveTextContent("保存に時間がかかっています");
    edit("長い待ちの追加編集"); expect(input()).toHaveValue("長い待ちの追加編集");
    canonical = { board: board({ "2026-09-01": "送信値" }), revision: 2 };
    await act(async () => slow.resolve(canonical));
    patch = async body => ({ board: applyBoardChanges(canonical.board, body.changes) as ReturnType<typeof board>, revision: 3 });
    await flush(400);
    expect(input()).toHaveValue("長い待ちの追加編集"); expect(pending).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("status")).toHaveTextContent("同期済み");
  });

});
