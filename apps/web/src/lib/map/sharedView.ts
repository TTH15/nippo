"use client";

// 地図の共有ビュー（配車作戦盤 Stage 1）。
// 同じ org の参加者どうしで Supabase Realtime broadcast/presence を使い、
//   - 在席（参加者一覧）
//   - カーソル位置（地図上の色付きドット＋名前）
//   - 視点（フォロー中の相手のカメラに追従）
// を同期する。DB には一切触れない（入場券は /api/admin/map/share-session が発行）。
import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { apiFetch } from "@/lib/api";

export type ShareParticipant = {
  id: string;
  name: string;
  color: string;
};

type CameraPayload = {
  id: string;
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
};

type CursorPayload = { id: string; lng: number; lat: number } | { id: string; lng: null; lat: null };

// 参加者の識別色。sessionId のハッシュで安定的に割り当てる。
const COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const colorFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
};

const throttle = <A extends unknown[]>(fn: (...args: A) => void, ms: number) => {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  return (...args: A) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else {
      pending = args;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          if (pending) fn(...pending);
          pending = null;
        }, ms - (now - last));
      }
    }
  };
};

function cursorElement(name: string, color: string): HTMLElement {
  const el = document.createElement("div");
  el.style.pointerEvents = "none";
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:4px;transform:translate(4px,4px)">
      <div style="width:10px;height:10px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>
      <div style="background:${color};color:#fff;font-size:10px;font-weight:700;line-height:1;padding:3px 6px;border-radius:9999px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25)">${name.replace(/[<>&]/g, "")}</div>
    </div>`;
  return el;
}

export function useSharedMapView(opts: {
  getMap: () => mapboxgl.Map | null;
  selfName: string;
  active: boolean;
}) {
  const { getMap, selfName, active } = opts;
  const [participants, setParticipants] = useState<ShareParticipant[]>([]);
  const [followingId, setFollowingId] = useState<string | null>(null);
  const [status, setStatus] = useState<"off" | "connecting" | "connected" | "error">("off");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selfIdRef = useRef<string>("");
  if (!selfIdRef.current && typeof crypto !== "undefined") {
    selfIdRef.current = crypto.randomUUID().slice(0, 8);
  }
  const channelRef = useRef<RealtimeChannel | null>(null);
  const clientRef = useRef<SupabaseClient | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const followingRef = useRef<string | null>(null);
  followingRef.current = followingId;
  // フォロー適用中の easeTo が発火させる move イベントを自分の視点送信と区別する。
  const applyingRemoteRef = useRef(false);

  const cleanup = useCallback(() => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();
    if (channelRef.current) {
      void channelRef.current.unsubscribe();
      channelRef.current = null;
    }
    if (clientRef.current) {
      void clientRef.current.removeAllChannels();
      clientRef.current = null;
    }
    setParticipants([]);
    setFollowingId(null);
    setStatus("off");
  }, []);

  useEffect(() => {
    if (!active) {
      cleanup();
      return;
    }
    const map = getMap();
    if (!map) return;
    let disposed = false;
    setStatus("connecting");
    setErrorMsg(null);

    const selfId = selfIdRef.current;
    const offFns: Array<() => void> = [];

    (async () => {
      let session: { url: string; anonKey: string; channel: string };
      try {
        session = await apiFetch<{ url: string; anonKey: string; channel: string }>(
          "/api/admin/map/share-session",
        );
      } catch (e) {
        if (!disposed) {
          setStatus("error");
          setErrorMsg(e instanceof Error ? e.message : "共有ビューに接続できませんでした");
        }
        return;
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

      const syncParticipants = () => {
        const state = channel.presenceState<{ name: string }>();
        const list: ShareParticipant[] = Object.entries(state).map(([key, metas]) => ({
          id: key,
          name: metas[0]?.name ?? "？",
          color: colorFor(key),
        }));
        list.sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : a.id.localeCompare(b.id)));
        setParticipants(list);
        // 退室した相手のカーソルとフォローを掃除
        const ids = new Set(list.map((p) => p.id));
        markersRef.current.forEach((marker, id) => {
          if (!ids.has(id)) {
            marker.remove();
            markersRef.current.delete(id);
          }
        });
        if (followingRef.current && !ids.has(followingRef.current)) setFollowingId(null);
      };

      channel
        .on("presence", { event: "sync" }, syncParticipants)
        .on("broadcast", { event: "camera" }, ({ payload }) => {
          const p = payload as CameraPayload;
          if (p.id !== followingRef.current) return;
          const m = getMap();
          if (!m) return;
          applyingRemoteRef.current = true;
          m.easeTo({ center: p.center, zoom: p.zoom, bearing: p.bearing, pitch: p.pitch, duration: 150 });
          // easeTo の moveend 後にフラグを戻す（多少余裕を持たせる）
          setTimeout(() => {
            applyingRemoteRef.current = false;
          }, 200);
        })
        .on("broadcast", { event: "cursor" }, ({ payload }) => {
          const p = payload as CursorPayload;
          const m = getMap();
          if (!m || p.id === selfId) return;
          const existing = markersRef.current.get(p.id);
          if (p.lng == null || p.lat == null) {
            existing?.remove();
            markersRef.current.delete(p.id);
            return;
          }
          if (existing) {
            existing.setLngLat([p.lng, p.lat]);
          } else {
            const state = channel.presenceState<{ name: string }>();
            const name = state[p.id]?.[0]?.name ?? "？";
            const marker = new mapboxgl.Marker({ element: cursorElement(name, colorFor(p.id)), anchor: "top-left" })
              .setLngLat([p.lng, p.lat])
              .addTo(m);
            markersRef.current.set(p.id, marker);
          }
        })
        .subscribe(async (s) => {
          if (disposed) return;
          if (s === "SUBSCRIBED") {
            setStatus("connected");
            await channel.track({ name: selfName });
          } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
            setStatus("error");
            setErrorMsg("共有ビューの接続が切れました");
          }
        });

      // --- 自分の状態を流す ---
      const sendCamera = throttle(() => {
        if (applyingRemoteRef.current) return;
        const m = getMap();
        if (!m) return;
        const c = m.getCenter();
        void channel.send({
          type: "broadcast",
          event: "camera",
          payload: {
            id: selfId,
            center: [c.lng, c.lat],
            zoom: m.getZoom(),
            bearing: m.getBearing(),
            pitch: m.getPitch(),
          } satisfies CameraPayload,
        });
      }, 150);
      const sendCursor = throttle((lng: number, lat: number) => {
        void channel.send({ type: "broadcast", event: "cursor", payload: { id: selfId, lng, lat } });
      }, 120);

      const onMove = () => sendCamera();
      const onMouseMove = (e: mapboxgl.MapMouseEvent) => sendCursor(e.lngLat.lng, e.lngLat.lat);
      const onMouseOut = () => {
        void channel.send({ type: "broadcast", event: "cursor", payload: { id: selfId, lng: null, lat: null } });
      };
      // 自分でドラッグしたらフォロー解除（視点の取り合いを防ぐ）
      const onDragStart = () => {
        if (!applyingRemoteRef.current) setFollowingId(null);
      };
      map.on("move", onMove);
      map.on("mousemove", onMouseMove);
      map.on("mouseout", onMouseOut);
      map.on("dragstart", onDragStart);
      offFns.push(() => {
        map.off("move", onMove);
        map.off("mousemove", onMouseMove);
        map.off("mouseout", onMouseOut);
        map.off("dragstart", onDragStart);
      });
    })();

    return () => {
      disposed = true;
      offFns.forEach((f) => f());
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return {
    selfId: selfIdRef.current,
    participants,
    followingId,
    setFollowingId,
    status,
    errorMsg,
  };
}
