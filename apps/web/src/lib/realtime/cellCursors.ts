"use client";

// 参加者・操作中セルと確定版の通知だけを共有する。盤面の正本は認証済みAPIで読む。
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { apiFetch } from "@/lib/api";

export type CellPeer = { id: string; name: string; color: string };
const COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const colorFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
};
type Cursor = { key: string | null; sequence: number };

export function useCellCursors(opts: { scope: string; selfName: string; enabled?: boolean; onRevision?: (revision: number) => void }) {
  const { scope, enabled = true } = opts;
  const [peers, setPeers] = useState<CellPeer[]>([]);
  const [cellPeers, setCellPeers] = useState<Record<string, CellPeer[]>>({});
  const [connected, setConnected] = useState(false);
  const selfIdRef = useRef("");
  if (!selfIdRef.current && typeof crypto !== "undefined") selfIdRef.current = crypto.randomUUID();
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const desiredRef = useRef<Cursor>({ key: null, sequence: 0 });
  const sendRef = useRef<() => void>(() => {});
  const announceRef = useRef<(revision: number) => void>(() => {});

  useEffect(() => {
    desiredRef.current = { key: null, sequence: desiredRef.current.sequence + 1 };
    if (!enabled) return;
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let trackTimer: ReturnType<typeof setTimeout> | undefined;
    let sendTimer: ReturnType<typeof setTimeout> | undefined;
    let release: (() => void) | undefined;
    const selfId = selfIdRef.current;
    const clearPeers = () => { setConnected(false); setPeers([]); setCellPeers({}); };

    const connect = async () => {
      const generation = ++attempt;
      release?.();
      clearPeers();
      const retry = () => {
        if (disposed || generation !== attempt) return;
        clearTimeout(retryTimer);
        clearPeers();
        retryTimer = setTimeout(() => { void connect(); }, Math.min(30000, 2000 * 2 ** Math.min(generation - 1, 4)));
      };
      try {
        const session = await apiFetch<{ url: string; anonKey: string; channel: string }>(
          `/api/admin/map/share-session?scope=${encodeURIComponent(scope)}`,
        );
        if (disposed || generation !== attempt) return;
        const client = createClient(session.url, session.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const channel = client.channel(session.channel, { config: { presence: { key: selfId }, broadcast: { self: false } } });
        let subscribed = false;
        let lastSent: string | undefined;
        let trackBusy = false;
        const names = new Map<string, string>();
        const cells = new Map<string, Cursor>();
        const valid = () => !disposed && generation === attempt;
        const publish = () => {
          if (!valid()) return;
          const list = [...names.entries()].filter(([id]) => id !== selfId).map(([id, name]) => ({ id, name, color: colorFor(id) }));
          setPeers(list);
          const next: Record<string, CellPeer[]> = {};
          for (const peer of list) {
            const key = cells.get(peer.id)?.key;
            if (key) (next[key] ??= []).push(peer);
          }
          setCellPeers(next);
        };
        const remember = (id: string, cursor: Cursor) => {
          if (typeof cursor.sequence !== "number" || !Number.isFinite(cursor.sequence)) return;
          if (cursor.key !== null && typeof cursor.key !== "string") return;
          if ((cells.get(id)?.sequence ?? -1) <= cursor.sequence) cells.set(id, cursor);
        };
        const track = async () => {
          if (!valid() || !subscribed || trackBusy) return;
          trackBusy = true;
          const state = { ...desiredRef.current, name: optsRef.current.selfName };
          try {
            const status = await channel.track(state);
            if (status !== "ok" && valid()) trackTimer = setTimeout(() => { void track(); }, 2000);
          } catch { if (valid()) trackTimer = setTimeout(() => { void track(); }, 2000); }
          finally {
            trackBusy = false;
            if (valid() && JSON.stringify({ ...desiredRef.current, name: optsRef.current.selfName }) !== JSON.stringify(state)) {
              clearTimeout(trackTimer);
              trackTimer = setTimeout(() => { void track(); }, 1000);
            }
          }
        };
        const send = async (force = false) => {
          if (!valid() || !subscribed) return;
          const cursor = { ...desiredRef.current };
          const signature = JSON.stringify(cursor);
          if (!force && signature === lastSent) return;
          try {
            const status = await channel.send({ type: "broadcast", event: "cell", payload: { id: selfId, ...cursor } });
            if (!valid()) return;
            if (status === "ok") {
              lastSent = signature;
              if (JSON.stringify(desiredRef.current) !== signature) void send();
            } else sendTimer = setTimeout(() => { void send(true); }, 2000);
          } catch { if (valid()) sendTimer = setTimeout(() => { void send(true); }, 2000); }
        };
        sendRef.current = () => {
          void send();
          // Broadcastは即時、Presenceは低頻度。遅れて入った参加者にも編集中セルを渡す。
          clearTimeout(trackTimer);
          trackTimer = setTimeout(() => { void track(); }, 1000);
        };
        announceRef.current = revision => {
          if (valid() && subscribed) void channel.send({ type: "broadcast", event: "revision", payload: { revision } }).catch(() => {});
        };
        const heartbeat = setInterval(() => {
          if (!valid() || !subscribed) return;
          void track(); void send(true);
        }, 10000);
        release = () => {
          subscribed = false;
          clearInterval(heartbeat); clearTimeout(trackTimer); clearTimeout(sendTimer);
          void channel.untrack().catch(() => {});
          void channel.unsubscribe().catch(() => {});
          void client.removeAllChannels().catch(() => {});
        };
        channel
          .on("presence", { event: "sync" }, () => {
            if (!valid() || !subscribed) return;
            const state = channel.presenceState<{ name?: string; key?: string | null; sequence?: number }>();
            names.clear();
            for (const [id, metas] of Object.entries(state)) {
              for (const meta of metas) {
                names.set(id, typeof meta.name === "string" ? meta.name : "？");
                if (meta.key !== undefined) remember(id, { key: meta.key, sequence: meta.sequence ?? 0 });
              }
            }
            for (const id of cells.keys()) if (!names.has(id)) cells.delete(id);
            publish();
          })
          .on("broadcast", { event: "cell" }, ({ payload }) => {
            if (!valid() || !subscribed || !payload || typeof payload.id !== "string" || payload.id === selfId) return;
            // 旧クライアントのBroadcastとも互換。新しいPresenceより古い通知は戻さない。
            remember(payload.id, { key: payload.key, sequence: payload.sequence ?? (cells.get(payload.id)?.sequence ?? 0) + 1 });
            publish();
          })
          .on("broadcast", { event: "revision" }, ({ payload }) => {
            if (!valid() || !subscribed) return;
            const revision = payload?.revision;
            if (typeof revision === "number" && Number.isSafeInteger(revision) && revision > 0) optsRef.current.onRevision?.(revision);
          })
          .subscribe(status => {
            if (!valid()) return;
            if (status === "SUBSCRIBED") {
              clearTimeout(retryTimer);
              subscribed = true; lastSent = undefined;
              setConnected(true);
              void track(); void send(true);
            } else {
              subscribed = false; clearPeers();
              if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") retry();
            }
          });
      } catch { retry(); }
    };
    const recover = () => { clearTimeout(retryTimer); void connect(); };
    window.addEventListener("online", recover);
    void connect();
    return () => {
      disposed = true; ++attempt;
      clearTimeout(retryTimer); clearTimeout(trackTimer); clearTimeout(sendTimer);
      release?.();
      sendRef.current = () => {}; announceRef.current = () => {};
      desiredRef.current = { key: null, sequence: desiredRef.current.sequence + 1 };
      window.removeEventListener("online", recover);
      clearPeers();
    };
  }, [enabled, scope]);

  const reportCell = useCallback((key: string | null) => {
    if (desiredRef.current.key !== key) desiredRef.current = { key, sequence: desiredRef.current.sequence + 1 };
    sendRef.current();
  }, []);
  const announceRevision = useCallback((revision: number) => announceRef.current(revision), []);
  return { peers, cellPeers, connected, reportCell, announceRevision };
}
