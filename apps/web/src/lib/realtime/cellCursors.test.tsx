import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ api: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mock.api }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mock.create }));
import { useCellCursors } from "./cellCursors";

type Handler = (event?: any) => void;
function makeChannel() {
  const handlers = new Map<string, Handler>();
  let status: Handler = () => {};
  let state: Record<string, { name: string; key?: string | null; sequence?: number }[]> = {};
  const channel = {
    on: vi.fn((type: string, filter: { event: string }, handler: Handler) => { handlers.set(`${type}:${filter.event}`, handler); return channel; }),
    subscribe: vi.fn((handler: Handler) => { status = handler; return channel; }),
    track: vi.fn().mockResolvedValue("ok"), send: vi.fn().mockResolvedValue("ok"),
    untrack: vi.fn().mockResolvedValue("ok"), unsubscribe: vi.fn().mockResolvedValue("ok"),
    presenceState: () => state,
    status: (value: string) => status(value),
    presence: (value: typeof state) => { state = value; handlers.get("presence:sync")?.(); },
    broadcast: (event: string, payload: unknown) => handlers.get(`broadcast:${event}`)?.({ payload }),
  };
  return channel;
}
let channels: ReturnType<typeof makeChannel>[];
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(() => {
  vi.useFakeTimers(); channels = []; mock.api.mockReset(); mock.create.mockReset();
  mock.api.mockResolvedValue({ url: "https://fixture.invalid", anonKey: "fixture", channel: "fixture" });
  mock.create.mockImplementation(() => {
    const channel = makeChannel(); channels.push(channel);
    return { channel: () => channel, removeAllChannels: vi.fn().mockResolvedValue([]) };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("cell cursors", () => {
  it("遅れて入った参加者へPresenceの編集中セルを表示し古い状態へ戻さない", async () => {
    const { result } = renderHook(() => useCellCursors({ scope: "shift-memo", selfName: "自分" }));
    await flush(); const channel = channels[0];
    act(() => channel.status("SUBSCRIBED")); await flush();
    act(() => channel.presence({ peer: [{ name: "担当者", key: "notes:2026-09-01", sequence: 1 }] }));
    expect(result.current.cellPeers["notes:2026-09-01"][0].name).toBe("担当者");
    act(() => channel.broadcast("cell", { id: "peer", key: "lane|2026-09-01", sequence: 2 }));
    act(() => channel.presence({ peer: [{ name: "担当者", key: "notes:2026-09-01", sequence: 1 }] }));
    expect(result.current.cellPeers["lane|2026-09-01"]).toHaveLength(1);
    expect(result.current.cellPeers["notes:2026-09-01"]).toBeUndefined();
    act(() => channel.presence({}));
    expect(result.current.peers).toEqual([]); expect(result.current.cellPeers).toEqual({});
  });

  it("入場前のセルを覚え、同じセルへの再接続でPresenceとBroadcastを再送する", async () => {
    const { result } = renderHook(() => useCellCursors({ scope: "shift-memo", selfName: "自分" }));
    act(() => result.current.reportCell("notes:2026-09-01")); await flush();
    act(() => channels[0].status("SUBSCRIBED")); await flush();
    expect(channels[0].track).toHaveBeenLastCalledWith(expect.objectContaining({ key: "notes:2026-09-01" }));
    act(() => channels[0].status("CHANNEL_ERROR")); await flush(2000);
    expect(result.current.connected).toBe(false);
    act(() => channels[1].status("SUBSCRIBED")); await flush();
    expect(channels[1].send).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ key: "notes:2026-09-01" }) }));
    expect(channels[1].track).toHaveBeenLastCalledWith(expect.objectContaining({ key: "notes:2026-09-01" }));
    expect(result.current.connected).toBe(true);
  });

  it("セル通知・Presenceの失敗は再試行し、退出とnullで表示を消す", async () => {
    const { result, unmount } = renderHook(() => useCellCursors({ scope: "shift-memo", selfName: "自分" }));
    await flush(); const channel = channels[0];
    channel.track.mockResolvedValueOnce("error");
    act(() => channel.status("SUBSCRIBED")); await flush();
    channel.send.mockResolvedValueOnce("error");
    act(() => result.current.reportCell("cell")); await flush(2000);
    expect(channel.send.mock.calls.filter(([message]) => message.payload.key === "cell").length).toBeGreaterThanOrEqual(2);
    expect(channel.track).toHaveBeenLastCalledWith(expect.objectContaining({ key: "cell" }));
    act(() => result.current.reportCell(null)); await flush(1000);
    expect(channel.track).toHaveBeenLastCalledWith(expect.objectContaining({ key: null }));
    unmount(); expect(channel.untrack).toHaveBeenCalled(); expect(channel.unsubscribe).toHaveBeenCalled();
  });

  it("入場券取得失敗から復帰し、古いscopeの応答と通知は無視する", async () => {
    let finish!: (session: unknown) => void;
    mock.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const onRevision = vi.fn();
    const { result, rerender } = renderHook(({ scope }) => useCellCursors({ scope, selfName: "自分", onRevision }), { initialProps: { scope: "old" } });
    await flush(); mock.api.mockRejectedValueOnce(new Error("offline"));
    rerender({ scope: "shift-memo" }); await flush(2000);
    expect(channels).toHaveLength(1);
    await act(async () => finish({ url: "https://old.invalid", anonKey: "old", channel: "old" }));
    expect(channels).toHaveLength(1);
    act(() => channels[0].status("SUBSCRIBED")); await flush();
    act(() => channels[0].broadcast("revision", { revision: 3 }));
    expect(onRevision).toHaveBeenLastCalledWith(3); expect(result.current.connected).toBe(true);
  });
  it("共有表示へ再入場してもセル順序を巻き戻さず、退出前の通知を拒否する", async () => {
    const onRevision = vi.fn();
    const { result, rerender } = renderHook(({ enabled }) => useCellCursors({ scope: "shift-memo", selfName: "自分", enabled, onRevision }), { initialProps: { enabled: true } });
    await flush(); act(() => channels[0].status("SUBSCRIBED")); await flush();
    act(() => result.current.reportCell("old-cell")); await flush(1000);
    const previous = channels[0].track.mock.calls.at(-1)![0].sequence;
    rerender({ enabled: false }); await flush();
    act(() => channels[0].broadcast("revision", { revision: 99 })); expect(onRevision).not.toHaveBeenCalled();
    rerender({ enabled: true }); await flush(); act(() => result.current.reportCell("new-cell"));
    act(() => channels[1].status("SUBSCRIBED")); await flush();
    const current = channels[1].track.mock.calls.at(-1)![0];
    expect(current.key).toBe("new-cell"); expect(current.sequence).toBeGreaterThan(previous);
  });

});
