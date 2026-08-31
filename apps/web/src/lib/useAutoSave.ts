"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================
// 自動保存フック（2026-08-06）。
//
// 全画面に同じ挙動を広げるために、ドライバー編集で個別に書いていたロジックを切り出した。
// 設計の要点は「保存を画面の寿命に縛らない」こと:
//   ・デバウンス中の保存を **クリーンアップで取り消さない**。取り消すと、モーダルを閉じた／
//     別ページへ移った瞬間に保存が消える（実際に起きていた不具合・2026-08-06）
//   ・離脱時（unmount / pagehide / タブ非表示）は取り消しではなく **flush（即実行）**。
//     fetch は unmount では中断されないので、投げてしまえば完了する
//   ・保存中に来た変更は捨てずに、完了後にもう一度保存する（最後の入力を必ず反映する）
//   ・失敗しても値は保持し、次の flush で再送できる
// ============================================================

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export type UseAutoSaveOptions<T> = {
  /** 監視する値。変化したら保存をスケジュールする */
  value: T;
  /** 実際の保存処理。throw すると status は "error" になる */
  onSave: (value: T) => Promise<void>;
  /** false の間はスケジュールしない（権限なし・入力不正・読み込み中など） */
  enabled?: boolean;
  /** デバウンス時間（ms） */
  delay?: number;
  /**
   * 初回の値では保存しない（フォームへの初期流し込みを「変更」と誤認しないため）。
   * enabled が false→true になった直後の値も初回として扱う。
   */
  skipFirst?: boolean;
  /** 値の同一性判定。既定は JSON。フォームは毎レンダー新しい参照になるため必須 */
  serialize?: (value: T) => string;
  /**
   * 編集対象が変わったことを示すキー（例: 編集中のドライバーID）。
   * 変わると「次の値が初回」として扱い、別レコードの読み込みを変更と誤認しない。
   */
  resetKey?: string | number | null;
};

export type UseAutoSave = {
  status: AutoSaveStatus;
  error: Error | null;
  /** 保留中の保存を今すぐ実行する（モーダルを閉じるとき等）。何も無ければ何もしない */
  flush: () => Promise<boolean>;
  /** 明示的な再試行。失敗直後の新規→編集切替でも保存を実行する */
  retry: () => Promise<boolean>;
  /** 保留中の保存があるか（「保存中…」表示や離脱確認に使う） */
  hasPending: boolean;
};

export function useAutoSave<T>({
  value,
  onSave,
  enabled = true,
  delay = 1000,
  skipFirst = true,
  serialize = (v) => JSON.stringify(v),
  resetKey = null,
}: UseAutoSaveOptions<T>): UseAutoSave {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [hasPending, setHasPending] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  const lastSerialized = useRef<string | null>(null);
  const savingRef = useRef(false);
  const activeRunRef = useRef<Promise<boolean> | null>(null);
  const lastRunSucceededRef = useRef(true);
  /** 保存中に来た変更。完了後にもう一度保存する */
  const dirtyWhileSaving = useRef(false);
  // 最新の onSave を参照する（依存に入れると毎レンダー再スケジュールされてしまう）
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;



  const run = useCallback((): Promise<boolean> => {
    if (savingRef.current) {
      // 実行中なら、終わったあとにもう一度走らせる（最後の入力を落とさない）
      dirtyWhileSaving.current = true;
      return activeRunRef.current ?? Promise.resolve(true);
    }
    const execute = async () => {
      let succeeded = true;
      do {
        dirtyWhileSaving.current = false;
        savingRef.current = true;
        setStatus("saving");
        setHasPending(false);
        try {
          await onSaveRef.current(latest.current);
          setError(null);
          setStatus("saved");
          succeeded = true;
        } catch (e) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setStatus("error");
          succeeded = false;
        } finally {
          savingRef.current = false;
        }
      } while (dirtyWhileSaving.current);
      lastRunSucceededRef.current = succeeded;
      return succeeded;
    };
    const promise = execute();
    activeRunRef.current = promise;
    void promise.finally(() => {
      if (activeRunRef.current === promise) activeRunRef.current = null;
    });
    return promise;
  }, []);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      return run();
    }
    if (activeRunRef.current) return activeRunRef.current;
    // 直前の保存が失敗している場合は、閉じる操作を再試行として扱う。
    if (!lastRunSucceededRef.current) return run();
    return Promise.resolve(true);
  }, [run]);

  const retry = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    return run();
  }, [run]);

  // 編集対象の切り替え。**値の effect より前に宣言する**こと（宣言順に実行されるため、
  // ここではまだ latest.current が前のレコードの値＝保留中の入力を正しく保存できる）。
  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      void run(); // 前のレコードの入力を捨てない
    }
    lastSerialized.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) return;
    latest.current = value; // 保存時に読む値はここで確定させる（render 中には触らない）
    const serialized = serialize(value);
    if (lastSerialized.current === null) {
      // 初回（またはこのフックが有効になった最初の値）
      lastSerialized.current = serialized;
      if (skipFirst) return;
    } else if (lastSerialized.current === serialized) {
      return; // 実質的な変更なし
    } else {
      lastSerialized.current = serialized;
    }

    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    setHasPending(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      void run();
    }, delay);
    // ★クリーンアップで clearTimeout しないこと。デバウンスは次回実行の冒頭で成立しており、
    //   ここで取り消すと「閉じたら保存が消える」不具合に戻る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled, delay, skipFirst, run]);

  // 離脱時は取り消さずに飛ばす
  useEffect(() => {
    const onHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [flush]);

  return { status, error, flush, retry, hasPending };
}
