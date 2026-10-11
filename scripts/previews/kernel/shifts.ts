// 通信は隔離。参加者シナリオでは表示だけを架空データで確認する。
import { useCallback, useEffect, useRef, useState } from "react";
import { getPreviewRuntime } from "./runtime";
type Peer = { id: string; name: string; color: string };
export const useCellCursors = (opts?: { scope?: string; selfName?: string; enabled?: boolean; onRevision?: (revision: number) => void }) => {
  const runtime = getPreviewRuntime();
  const scenario = new URLSearchParams(runtime.search).get("scenario");
  const live = opts?.enabled !== false && opts?.scope === "shift-memo" && ["shared-live", "shared-missed"].includes(scenario ?? "");
  const staticPeer = opts?.enabled !== false && opts?.scope === "shift-memo" && scenario === "shared-peers";
  const desiredCellRef = useRef<string | null>(null);
  const selfName = `${opts?.selfName ?? "サンプル管理者"}${new URLSearchParams(runtime.search).get("editor") ? `（${new URLSearchParams(runtime.search).get("editor")}）` : ""}`;
  const [livePeers, setLivePeers] = useState<Peer[]>([]);
  const [cellPeers, setCellPeers] = useState<Record<string, Peer[]>>({});
  const channelRef = useRef<BroadcastChannel | null>(null);
  const selfIdRef = useRef(`preview-${Math.random().toString(36).slice(2, 8)}`);
  const onRevisionRef = useRef(opts?.onRevision);
  onRevisionRef.current = opts?.onRevision;
  useEffect(() => {
    if (!live) return;
    const id = selfIdRef.current;
    const channel = new BroadcastChannel("hakotora-preview-shared-memo");
    channelRef.current = channel;
    const peers = new Map<string, Peer>();
    const cells = new Map<string, string>();
    const publish = () => {
      setLivePeers([...peers.values()]);
      const next: Record<string, Peer[]> = {};
      for (const [peerId, key] of cells) {
        const peer = peers.get(peerId);
        if (peer) (next[key] ??= []).push(peer);
      }
      setCellPeers(next);
    };
    channel.onmessage = (event: MessageEvent<{ kind: string; id: string; name?: string; key?: string | null; revision?: number }>) => {
      const message = event.data;
      if (message.id === id) return;
      if (message.kind === "join" || message.kind === "hello") {
        peers.set(message.id, { id: message.id, name: message.name ?? "サンプル担当者", color: "#3b82f6" });
        if (message.key) cells.set(message.id, message.key); else cells.delete(message.id);
        if (message.kind === "join") channel.postMessage({ kind: "hello", id, name: selfName, key: desiredCellRef.current });
      } else if (message.kind === "leave") {
        peers.delete(message.id); cells.delete(message.id);
      } else if (message.kind === "cell") {
        if (message.key) cells.set(message.id, message.key);
        else cells.delete(message.id);
      } else if (message.kind === "revision" && typeof message.revision === "number") {
        if (scenario !== "shared-missed") { runtime.store.invalidate(); onRevisionRef.current?.(message.revision); }
      }
      publish();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "hakotora_preview_shared_memo_live_v1" || scenario === "shared-missed") return;
      runtime.store.invalidate();
      onRevisionRef.current?.(Date.now());
    };
    window.addEventListener("storage", onStorage);
    channel.postMessage({ kind: "join", id, name: selfName, key: desiredCellRef.current });
    const heartbeat = setInterval(() => channel.postMessage({ kind: "hello", id, name: selfName, key: desiredCellRef.current }), 10000);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("storage", onStorage);
      channel.postMessage({ kind: "leave", id });
      channel.close(); channelRef.current = null;
      setLivePeers([]); setCellPeers({});
    };
  }, [live, selfName, runtime.store, scenario]);
  const reportCell = useCallback((key: string | null) => {
    desiredCellRef.current = key;
    channelRef.current?.postMessage({ kind: "cell", id: selfIdRef.current, key });
  }, []);
  const announceRevision = useCallback((revision: number) => {
    channelRef.current?.postMessage({ kind: "revision", id: selfIdRef.current, revision });
  }, []);
  return { reportCell, announceRevision, cellPeers: staticPeer ? { [desiredCellRef.current ?? `notes:${new Date().toISOString().slice(0, 10)}`]: [{ id: "preview-peer", name: "サンプル担当者", color: "#3b82f6" }] } : cellPeers,
    peers: staticPeer ? [{ id: "preview-peer", name: "サンプル担当者", color: "#3b82f6" }] : livePeers,
    connected: live || staticPeer };
};
export const summarizeHistory = () => [];
