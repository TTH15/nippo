"use client";

// グリッド画面（シフト表など）の「誰がどのセルを触っているか」共有。
// Supabase Realtime の presence + broadcast のみ使用（DB 不触・入場券は
// /api/admin/map/share-session?scope=... が発行）。ページ表示中は自動接続の
// アンビエント表示で、未設定・接続失敗時は黙って無効になる（編集機能に影響しない）。
import { useEffect, useRef, useState } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { apiFetch } from "@/lib/api";

export type CellPeer = { id: string; name: string; color: string };

const COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const colorFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
};

export function useCellCursors(opts: { scope: string; selfName: string; enabled?: boolean }) {
  const { scope, selfName, enabled = true } = opts;
  const [peers, setPeers] = useState<CellPeer[]>([]);
  /** cellKey → そのセルにカーソルを置いている相手 */
  const [cellPeers, setCellPeers] = useState<Record<string, CellPeer[]>>({});
  const [connected, setConnected] = useState(false);

  const selfIdRef = useRef("");
  if (!selfIdRef.current && typeof crypto !== "undefined") {
    selfIdRef.current = crypto.randomUUID().slice(0, 8);
  }
  const channelRef = useRef<RealtimeChannel | null>(null);
  const clientRef = useRef<SupabaseClient | null>(null);
  const lastSentRef = useRef<string | null>(null);
  // id → 現在のセル（presence 変動時の再構築用）
  const peerCellsRef = useRef<Map<string, string>>(new Map());
  const namesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const selfId = selfIdRef.current;

    const rebuild = () => {
      const next: Record<string, CellPeer[]> = {};
      peerCellsRef.current.forEach((cell, id) => {
        if (id === selfId) return;
        if (!namesRef.current.has(id)) return; // 退室済み
        (next[cell] ??= []).push({ id, name: namesRef.current.get(id) ?? "？", color: colorFor(id) });
      });
      setCellPeers(next);
    };

    (async () => {
      let session: { url: string; anonKey: string; channel: string };
      try {
        session = await apiFetch<{ url: string; anonKey: string; channel: string }>(
          `/api/admin/map/share-session?scope=${encodeURIComponent(scope)}`,
        );
      } catch {
        return; // 未設定・権限なしは黙って無効
      }
      if (disposed) return;

      const client = createClient(session.url, session.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      clientRef.current = client;
      const channel = client.channel(session.channel, {
        config: { presence: { key: selfId }, broadcast: { self: false } },
      });
      channelRef.current = channel;

      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<{ name: string }>();
          namesRef.current = new Map(Object.entries(state).map(([id, metas]) => [id, metas[0]?.name ?? "？"]));
          const list = Array.from(namesRef.current.entries())
            .filter(([id]) => id !== selfId)
            .map(([id, name]) => ({ id, name, color: colorFor(id) }));
          setPeers(list);
          // 退室者のセル表示を掃除
          peerCellsRef.current.forEach((_cell, id) => {
            if (!namesRef.current.has(id)) peerCellsRef.current.delete(id);
          });
          rebuild();
        })
        .on("broadcast", { event: "cell" }, ({ payload }) => {
          const p = payload as { id: string; key: string | null };
          if (p.id === selfId) return;
          if (p.key) peerCellsRef.current.set(p.id, p.key);
          else peerCellsRef.current.delete(p.id);
          rebuild();
        })
        .subscribe(async (s) => {
          if (disposed) return;
          if (s === "SUBSCRIBED") {
            setConnected(true);
            await channel.track({ name: selfName });
          }
        });
    })();

    return () => {
      disposed = true;
      if (channelRef.current) void channelRef.current.unsubscribe();
      if (clientRef.current) void clientRef.current.removeAllChannels();
      channelRef.current = null;
      clientRef.current = null;
      peerCellsRef.current.clear();
      setPeers([]);
      setCellPeers({});
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope]);

  /** 自分のカーソルがいるセルを通知する（同一セルは再送しない。null=グリッド外）。 */
  const reportCell = (key: string | null) => {
    if (!channelRef.current || key === lastSentRef.current) return;
    lastSentRef.current = key;
    void channelRef.current.send({
      type: "broadcast",
      event: "cell",
      payload: { id: selfIdRef.current, key },
    });
  };

  return { peers, cellPeers, connected, reportCell };
}
