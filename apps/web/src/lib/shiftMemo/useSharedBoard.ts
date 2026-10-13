"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { boardChanges, SharedBoardSession, type Board, type BoardChange } from "./sharedBoardSync";

type Reply = { board: Board | null; revision: number };
const PATH = "/api/admin/shifts/memo/board";
const CONFLICT = "同じ箇所に別の変更があります。入力は残っています";
type View = { ready: boolean; pending: boolean; saving: boolean; slow: boolean; syncing: boolean; error: string | null; conflict: boolean };
type Draft = { base: Board; local: Board; conflicts?: SharedBoardSession["conflicts"] };

export function useSharedBoard(opts: {
  enabled: boolean; identity: string; board: Board; canEdit: boolean;
  normalize: (board: Board) => Board; apply: (board: Board) => void;
  onPendingChange?: (pending: boolean) => void; announceRevision: (revision: number) => void;
  connected: boolean; remoteRevision: number;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const sessionRef = useRef<SharedBoardSession | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const scheduleRef = useRef<() => void>(() => {});
  const [view, setView] = useState<View>({ ready: false, pending: false, saving: false, slow: false, syncing: false, error: null, conflict: false });
  const serialized = JSON.stringify(opts.board);

  useEffect(() => {
    if (!opts.enabled) return;
    const session = new SharedBoardSession(optsRef.current.normalize({ version: 1, lanes: [] }));
    sessionRef.current = session;
    let active = true;
    let savingTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshing: Promise<void> | null = null;
    let refreshAgain = false;
    let error: string | null = null;
    let slow = false;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    let ready = false;
    const draftKey = `hakotora_shared_shift_memo_draft_v1:${opts.identity}`;
    let draft: Draft | null = null;
    try {
      const value = JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as Draft | null;
      if (value?.base?.version === 1 && value?.local?.version === 1) draft = value;
    } catch { /* 保存済み正本を先に読む */ }

    const publish = (syncing = !!refreshing) => {
      if (!active) return;
      const pending = session.pending;
      setView({ ready, pending, saving: !!session.flight, slow, syncing, error: session.conflicts.length ? CONFLICT : error, conflict: !!session.conflicts.length });
      optsRef.current.onPendingChange?.(pending);
      try {
        if (pending) sessionStorage.setItem(draftKey, JSON.stringify({ base: session.canonical, local: session.local,
          // 未解決競合の比較元もリロード後に保持する。
          conflicts: session.conflicts }));
        else if (!draft) sessionStorage.removeItem(draftKey);
      } catch { /* beforeunloadも未保存を保護する */ }
    };
    const apply = () => { if (active) optsRef.current.apply(session.local); };

    const schedule = () => {
      clearTimeout(savingTimer);
      if (!active || !optsRef.current.canEdit || !session.ready || session.flight || session.uncertain || session.conflicts.length || !session.changes.length) return;
      savingTimer = setTimeout(() => { void save(); }, session.changes.every(change => change.field === "notes") ? 400 : 80);
    };
    const accept = (reply: Reply, acknowledged?: Board) => {
      if (!active) return;
      const board = reply.board ? optsRef.current.normalize(reply.board) : null;
      if (session.accept(board, reply.revision, acknowledged)) apply();
    };
    const refresh = (): Promise<void> => {
      if (!active) return Promise.resolve();
      if (refreshing) { refreshAgain = true; return refreshing; }
      const task = (async () => {
        try {
          const reply = await apiFetch<Reply>(PATH);
          if (!active) return;
          if (draft) {
            session.canonical = draft.base;
            session.local = draft.local;
            session.ready = true;
            session.conflicts = draft.conflicts ?? [];
            draft = null;
          }
          accept(reply);
          session.uncertain = false;
          error = null;
          ready = true;
        } catch {
          if (!active) return;
          error = session.ready ? "同期を確認できませんでした。入力は残っています" : "共有メモを読み込めませんでした";
          ready = true; // エラーと再試行を表示する。未取得なら保存は開始しない。
        } finally {
          if (active) {
            refreshing = null;
            publish(false);
            schedule();
            if (refreshAgain) { refreshAgain = false; void refresh(); }
          }
        }
      })();
      refreshing = task;
      publish(true);
      return task;
    };
    const save = async () => {
      if (!active || !optsRef.current.canEdit) return;
      const flight = session.startSave();
      if (!flight) return;
      slow = false;
      slowTimer = setTimeout(() => { if (active && session.flight === flight) { slow = true; publish(); } }, 8000);
      publish();
      try {
        const reply = await apiFetch<Reply>(PATH, { method: "PATCH", body: JSON.stringify({
          initialBoard: session.revision === 0 ? session.canonical : null, changes: flight.changes,
        }) });
        if (!active) return;
        if (!reply.board) throw new Error("保存を確認できませんでした");
        // 先に受理したGETの正本は巻き戻さず、送信後の追加編集だけを重ねる。
        accept(reply, flight.snapshot);
        error = null;
        optsRef.current.announceRevision(session.revision);
      } catch {
        if (!active) return;
        session.uncertain = true;
        error = "保存を確認できませんでした。入力は残っています";
        // RPCの409に含まれる途中のboardも、通信エラーも正本とは扱わない。
        // 進行中GETがPATCH前に読んだ可能性があるので、必ず送信後に新しく読む。
        if (refreshing) await refreshing;
        if (!active) return;
        await refresh();
      } finally {
        if (active) {
          clearTimeout(slowTimer); slow = false;
          session.flight = null;
          publish();
          schedule();
        }
      }
    };
    refreshRef.current = refresh;
    scheduleRef.current = schedule;
    setView({ ready: false, pending: false, saving: false, slow: false, syncing: true, error: null, conflict: false });
    void refresh();
    const recover = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const warn = (event: BeforeUnloadEvent) => { if (session.pending) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    window.addEventListener("beforeunload", warn);
    // 接続中も通知欠落を補う。非表示タブは取得しない。
    const poll = setInterval(recover, 15000);
    return () => {
      active = false;
      clearTimeout(savingTimer); clearTimeout(slowTimer);
      clearInterval(poll);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", recover);
      window.removeEventListener("beforeunload", warn);
      if (sessionRef.current === session) sessionRef.current = null;
      optsRef.current.onPendingChange?.(false);
    };
  }, [opts.enabled, opts.identity]);

  useLayoutEffect(() => {
    const session = sessionRef.current;
    if (!opts.enabled || !session || !view.ready) return;
    if (boardChanges(session.local, opts.board).length) {
      session.edit(opts.board);
      // refresh経路と同じpublish処理でdraft / pendingを即時更新する。
      setView(current => ({ ...current, pending: session.pending, conflict: !!session.conflicts.length,
        error: session.conflicts.length ? CONFLICT : current.conflict ? null : current.error }));
      optsRef.current.onPendingChange?.(session.pending);
      try {
        const key = `hakotora_shared_shift_memo_draft_v1:${opts.identity}`;
        if (session.pending) sessionStorage.setItem(key, JSON.stringify({ base: session.canonical, local: session.local, conflicts: session.conflicts }));
        else sessionStorage.removeItem(key);
      } catch { /* beforeunloadで保護 */ }
      scheduleRef.current();
    }
  }, [serialized, opts.enabled, opts.identity, view.ready]);

  useEffect(() => {
    if (opts.enabled && view.ready) void refreshRef.current();
  }, [opts.connected, opts.remoteRevision]);
  useEffect(() => { if (opts.enabled) scheduleRef.current(); }, [opts.canEdit, opts.enabled]);

  const refresh = useCallback(() => { void refreshRef.current(); }, []);
  const resolve = useCallback((useLocal: boolean) => {
    const session = sessionRef.current;
    if (!session || session.flight || session.uncertain) return;
    session.resolve(useLocal);
    optsRef.current.apply(session.local);
    try {
      const key = `hakotora_shared_shift_memo_draft_v1:${optsRef.current.identity}`;
      if (session.pending) sessionStorage.setItem(key, JSON.stringify({ base: session.canonical, local: session.local, conflicts: [] }));
      else sessionStorage.removeItem(key);
    } catch { /* beforeunloadで保護 */ }
    setView(current => ({ ...current, pending: session.pending, conflict: false, error: null }));
    optsRef.current.onPendingChange?.(session.pending);
    scheduleRef.current();
  }, []);
  const remoteValue = (change: BoardChange) => change.key === undefined ? sessionRef.current?.canonical[change.field]
    : ((sessionRef.current?.canonical[change.field] ?? {}) as Board)[change.key];
  const describe = (value: unknown): string => {
    if (value == null) return "なし";
    if (typeof value === "boolean") return value ? "非表示" : "表示";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(item => typeof item === "object" && item ? String(item.name ?? "担当枠") : String(item)).join("、") || "なし";
    return "設定の変更";
  };
  return { ...view, refresh, resolve, conflicts: sessionRef.current?.conflicts ?? [], remoteValue, describe };
}
