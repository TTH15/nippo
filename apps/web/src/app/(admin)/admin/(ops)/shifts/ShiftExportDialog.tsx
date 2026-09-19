"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faDownload, faFilePdf, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { useModalKeys } from "@/lib/ui/dialog";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { captureShiftImage } from "@/lib/captureShiftImage";
import { exportEdgeVelocity } from "@/lib/shiftMemoExport";
import { pngsToPdf } from "@/lib/pdfExport";
import type { ShiftExportData } from "@/lib/shiftExport/data";
import {
  cellEdges, describeSelection, extendDays, extendRows, extendToCell, includedIndexes,
  isDayIncluded, isRowIncluded, isSelectAll, isSelectionEmpty, selectAll, selectCellRect,
  selectDays, selectRows, toggleDay, toggleRow,
  type ExportCell, type ShiftExportSelection,
} from "@/lib/shiftExport/selection";
import type { ClickMods } from "./ShiftExportBoard";
import { ShiftExportBoard } from "./ShiftExportBoard";
import { SHIFT_LEASE_NAMES, type ShiftLeaseMode } from "@/lib/shiftLease";

// ============================================================
// シフト表の出力。**出てくる表そのものをドラッグして**範囲を決める（Excel と同じ感覚）。
//   ・表の上をドラッグ … その矩形（日付 × 人）を出す
//   ・日付／名前の見出しをクリック … 範囲の中でも個別に出し入れする
//   外した部分は消さずグレーにする。どこを外したかが見えて、戻すのも1クリック。
//
//   画像化は日別配車と同じ手順（複製 → プレートを画像へ差し替え → html2canvas）。
//   PDF は作った PNG をそのまま入れるので、PNG と必ず同じ見た目になる。
// ============================================================

type Props = {
  /** 表示期間ぶんの全データ（選択前）。選択はこのダイアログが持つ */
  data: ShiftExportData;
  fileBase: string;
  formatDate: (iso: string) => string;
  onClose: () => void;
};

export function ShiftExportDialog({ data, fileBase, formatDate, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  /** 画像にする盤面。横長・縦長になっても1枚に収める（2026-09-19 ユーザー指定） */
  const captureRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<ShiftExportSelection>(selectAll);
  // 未割当の行は既定で入れない（出力の主役は割り当てぶん。2026-09-19 指摘）
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const [busy, setBusy] = useState<"png" | "pdf" | null>(null);
  const [error, setError] = useState("");
  /** ドラッグ中の種類。セル／行見出し／日付見出しで伸ばし方が変わる */
  const drag = useRef<{ kind: "cell"; start: ExportCell } | { kind: "row" | "day"; start: number } | null>(null);
  /** 端まで引いたときに表をスクロールさせるための、いまのポインタ位置と rAF */
  const scroller = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);

  useBodyScrollLock(true);
  useModalKeys(true, onClose, panelRef);

  const allDates = useMemo(() => data.days.map((d) => d.iso), [data.days]);
  const allDriverIds = useMemo(() => data.rows.map((r) => r.driverId), [data.rows]);
  const dayCount = allDates.length;
  const rowCount = allDriverIds.length;

  // ドラッグ中は pointerup をどこで離しても終われるように window で拾う
  useEffect(() => {
    const stop = () => {
      drag.current = null;
      pointer.current = null;
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
    };
    // Excel と同じく Cmd/Ctrl+A で全選択。ダイアログを開いている間だけ効く
    const selectEverything = (event: KeyboardEvent) => {
      if (event.key !== "a" && event.key !== "A") return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setSelection(selectAll);
    };
    const track = (event: PointerEvent) => {
      if (!drag.current) return;
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("pointermove", track);
    window.addEventListener("keydown", selectEverything);
    return () => {
      stop();
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("pointermove", track);
      window.removeEventListener("keydown", selectEverything);
    };
  }, []);

  // 実際に画像へ出る内容。選ばれていない行・列をここで落とす。
  const exportData = useMemo<ShiftExportData>(() => {
    const { days, rows } = includedIndexes(selection, dayCount, rowCount);
    const daySet = new Set(days);
    return {
      ...data,
      subtitle: describeSelection(selection, allDates, formatDate, rowCount),
      days: days.map((i) => data.days[i]),
      unassigned: includeUnassigned ? days.map((i) => data.unassigned[i] ?? "") : days.map(() => ""),
      rows: rows.map((r) => ({
        ...data.rows[r],
        cells: data.rows[r].cells.filter((_, i) => daySet.has(i)),
      })),
    };
  }, [data, selection, allDates, dayCount, rowCount, formatDate, includeUnassigned]);


  const nothingToExport = isSelectionEmpty(selection, dayCount, rowCount);
  const untouched = isSelectAll(selection);

  /**
   * ドラッグ中、表の端までポインタを持っていったらスクロールして追従する。
   * これが無いと、画面に入りきらない右側の日付を選べない（2026-09-19 指摘）。
   * 位置からセルを引くのは elementFromPoint。スクロール後の実際の位置で引き直せる。
   */
  const extendToPoint = (x: number, y: number) => {
    const state = drag.current;
    if (!state) return;
    // 端では枠の余白やスクロールバーの上に乗るのでセルに当たらない。
    // 当たるまで内側へ少しずつ寄せて探す（寄せないと最後の列が選べない）。
    const probe = (): HTMLElement | null => {
      const box = scroller.current?.getBoundingClientRect();
      for (let step = 0; step <= 6; step++) {
        const inset = step * 14;
        const px = box ? Math.min(Math.max(x, box.left + inset), box.right - inset) : x;
        const py = box ? Math.min(Math.max(y, box.top + inset), box.bottom - inset) : y;
        const hit = document
          .elementFromPoint(px, py)
          ?.closest<HTMLElement>("[data-export-cell],[data-export-day],[data-export-rowhead]");
        if (hit) return hit;
      }
      return null;
    };
    const hit = probe();
    if (!hit) return;
    if (state.kind === "cell") {
      const raw = hit.dataset.exportCell;
      if (!raw) return;
      const [dayIndex, rowIndex] = raw.split(":").map(Number);
      setSelection(selectCellRect(state.start, { dayIndex, rowIndex }, dayCount, rowCount));
      return;
    }
    if (state.kind === "row") {
      const raw = hit.dataset.exportRowhead ?? hit.dataset.exportCell?.split(":")[1];
      if (raw === undefined) return;
      setSelection((current) =>
        extendRows({ ...current, anchor: { dayIndex: 0, rowIndex: state.start } }, Number(raw), dayCount, rowCount),
      );
      return;
    }
    const raw = hit.dataset.exportDay ?? hit.dataset.exportCell?.split(":")[0];
    if (raw === undefined) return;
    setSelection((current) =>
      extendDays({ ...current, anchor: { dayIndex: state.start, rowIndex: 0 } }, Number(raw), dayCount),
    );
  };

  const runAutoScroll = () => {
    if (frame.current !== null) return;
    const step = () => {
      frame.current = null;
      // ★ドラッグが続く限り回し続ける。ポインタがまだ動いていない最初のフレームで
      //   止めてしまうと、押してから端へ持っていっても二度とスクロールしない。
      if (!drag.current) return;
      const box = scroller.current;
      const at = pointer.current;
      if (box && at) {
        const rect = box.getBoundingClientRect();
        const dx = exportEdgeVelocity(at.x, rect.left, rect.right);
        const dy = exportEdgeVelocity(at.y, rect.top, rect.bottom);
        if (dx !== 0 || dy !== 0) {
          const beforeLeft = box.scrollLeft;
          const beforeTop = box.scrollTop;
          box.scrollLeft = beforeLeft + dx;
          box.scrollTop = beforeTop + dy;
          // 動いたぶんだけ選択も伸ばす（端に着いて動かなければ何もしない）
          if (box.scrollLeft !== beforeLeft || box.scrollTop !== beforeTop) extendToPoint(at.x, at.y);
        }
      }
      frame.current = window.requestAnimationFrame(step);
    };
    frame.current = window.requestAnimationFrame(step);
  };

  const interaction = useMemo(
    () => ({
      dayIncluded: (i: number) => isDayIncluded(selection, i),
      rowIncluded: (i: number) => isRowIncluded(selection, i),
      edgesAt: (d: number, r: number) => cellEdges(selection, d, r, dayCount, rowCount),
      onSelectAll: () => {
        setSelection(selectAll);
      },
      // セル: クリック＝1セル、ドラッグ＝矩形、Shift+クリック＝起点から伸ばす
      onCellPointerDown: (cell: ExportCell, mods: ClickMods) => {
        if (mods.shift) {
          setSelection((s) => extendToCell(s, cell, dayCount, rowCount));
          return;
        }
        drag.current = { kind: "cell", start: cell };
        setSelection(selectCellRect(cell, cell, dayCount, rowCount));
        runAutoScroll();
      },
      onCellPointerEnter: (cell: ExportCell) => {
        const state = drag.current;
        if (state?.kind !== "cell") return;
        setSelection(selectCellRect(state.start, cell, dayCount, rowCount));
      },
      // 名前: クリック＝行全体、Shift＝起点の行から、Cmd/Ctrl＝足す／外す、ドラッグ＝連続した行
      onRowPointerDown: (rowIndex: number, mods: ClickMods) => {
        if (mods.meta) {
          setSelection((s) => toggleRow(s, rowIndex, rowCount));
          return;
        }
        if (mods.shift) {
          setSelection((s) => extendRows(s, rowIndex, dayCount, rowCount));
          return;
        }
        drag.current = { kind: "row", start: rowIndex };
        setSelection(selectRows([rowIndex], dayCount, rowCount, rowIndex));
        runAutoScroll();
      },
      onRowPointerEnter: (rowIndex: number) => {
        const state = drag.current;
        if (state?.kind !== "row") return;
        setSelection((s) => extendRows({ ...s, anchor: { dayIndex: 0, rowIndex: state.start } }, rowIndex, dayCount, rowCount));
      },
      // 日付: 名前と同じ扱いの列版
      onDayPointerDown: (dayIndex: number, mods: ClickMods) => {
        if (mods.meta) {
          setSelection((s) => toggleDay(s, dayIndex, dayCount));
          return;
        }
        if (mods.shift) {
          setSelection((s) => extendDays(s, dayIndex, dayCount));
          return;
        }
        drag.current = { kind: "day", start: dayIndex };
        setSelection(selectDays([dayIndex], dayCount, rowCount, dayIndex));
        runAutoScroll();
      },
      onDayPointerEnter: (dayIndex: number) => {
        const state = drag.current;
        if (state?.kind !== "day") return;
        setSelection((s) => extendDays({ ...s, anchor: { dayIndex: state.start, rowIndex: 0 } }, dayIndex, dayCount));
      },
    }),
    [selection, dayCount, rowCount],
  );

  /**
   * 契約区分ごとの行。コース単位の除外は「1人が Amazon にもヤマトにも入る」ため
   * 意味を持たない（2026-09-19 ユーザー判断）。契約区分は人に紐づくので絞り込みに使える。
   */
  const leaseGroups = useMemo(() => {
    const byMode = new Map<ShiftLeaseMode, number[]>();
    data.rows.forEach((row, index) => {
      if (!row.leaseMode) return;
      byMode.set(row.leaseMode, [...(byMode.get(row.leaseMode) ?? []), index]);
    });
    return (Object.keys(SHIFT_LEASE_NAMES) as ShiftLeaseMode[])
      .map((mode) => ({ mode, label: SHIFT_LEASE_NAMES[mode], rows: byMode.get(mode) ?? [] }))
      .filter((group) => group.rows.length > 0);
  }, [data.rows]);

  const save = async (format: "png" | "pdf") => {
    if (busy || nothingToExport || !captureRef.current) return;
    setBusy(format);
    setError("");
    try {
      // 選んだ範囲を1枚に収める。横に長くなってもそのまま出す。
      const shot = await captureShiftImage(captureRef.current);
      const link = document.createElement("a");
      if (format === "png") {
        link.href = shot.url;
        link.download = `${fileBase}.png`;
        link.click();
        return;
      }
      const pdf = await pngsToPdf([{ image: shot.url, width: shot.width, height: shot.height }]);
      const url = URL.createObjectURL(pdf);
      link.href = url;
      link.download = `${fileBase}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      console.error(e);
      setError("画像を作成できませんでした。読み込みが終わってから、もう一度お試しください。");
    } finally {
      setBusy(null);
    }
  };

  const buttonClass =
    "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed";

  return createPortal(
    <div className="modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="シフト表を画像にする"
        className="modal-panel-in flex max-h-[90vh] w-full max-w-6xl flex-col rounded-xl bg-white text-slate-800 shadow-lg outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">シフト表を画像にする</h2>
            <p className="truncate pt-0.5 text-[11px] text-slate-500">
              表をドラッグで範囲選択。名前・日付をクリックで行／列ごと、Shift で伸ばす、Cmd で足す・外す
            </p>
          </div>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-slate-100">
          {/* 選ぶための表。全体を出して、範囲の外をグレーにする */}
          <div className="w-max min-w-full">
            <ShiftExportBoard
              data={{
                ...data,
                subtitle: describeSelection(selection, allDates, formatDate, rowCount),
                unassigned: includeUnassigned ? data.unassigned : data.unassigned.map(() => ""),
              }}
              interaction={interaction}
            />
          </div>
          {nothingToExport && (
            <p className="p-4 text-xs text-rose-700">
              出せるものがありません。表をドラッグし直すか、「全部出す」を押してください。
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 px-4 py-3">
          {error && <p className="mb-2 text-xs text-rose-700">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={untouched}
                onClick={() => {
                  setSelection(selectAll);
                          }}
              >
                <FontAwesomeIcon icon={faRotateLeft} className="h-3.5 w-3.5" />
                全部出す
              </button>
              {leaseGroups.length > 1 && (
                <div className="flex items-center gap-1">
                  {leaseGroups.map((group) => {
                    const on = group.rows.every((i) => isRowIncluded(selection, i))
                      && data.rows.every((_, i) => group.rows.includes(i) || !isRowIncluded(selection, i));
                    return (
                      <button
                        key={group.mode}
                        type="button"
                        aria-pressed={on}
                        title={`${group.label}の${group.rows.length}人だけにする（Cmd で足す）`}
                        onClick={(event) => {
                          const meta = event.metaKey || event.ctrlKey;
                          setSelection((current) =>
                            meta
                              ? group.rows.reduce((acc, i) => toggleRow(acc, i, rowCount), current)
                              : selectRows(group.rows, dayCount, rowCount, group.rows[0] ?? 0),
                          );
                        }}
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                          on ? "border-slate-700 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {group.label}
                        <span className="pl-1 tabular-nums opacity-70">{group.rows.length}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={includeUnassigned}
                  onChange={(event) => setIncludeUnassigned(event.target.checked)}
                />
                未割当の行を入れる
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={buttonClass} disabled={!!busy || nothingToExport} onClick={() => void save("pdf")}>
                <FontAwesomeIcon icon={faFilePdf} className="h-3.5 w-3.5" />
                {busy === "pdf" ? "作成中…" : "PDFで保存"}
              </button>
              <button
                type="button"
                disabled={!!busy || nothingToExport}
                onClick={() => void save("png")}
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FontAwesomeIcon icon={faDownload} className="h-3.5 w-3.5" />
                {busy === "png" ? "作成中…" : "画像で保存"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 画像にする盤面。選んだぶんだけを1枚に描き、画面外に置いて複製元にする */}
      <div aria-hidden="true" inert className="pointer-events-none fixed -left-[10000px] top-0">
        <div ref={captureRef} className="w-max">
          {!nothingToExport && <ShiftExportBoard data={exportData} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
