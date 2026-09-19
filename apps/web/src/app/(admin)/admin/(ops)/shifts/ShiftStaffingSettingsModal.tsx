"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { cn } from "@/lib/ui/utils";
import ShiftStaffingExceptions from "./ShiftStaffingExceptions";

// ============================================================
// 曜日ごとの必要人数（会社の共有基準）。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1「必要人数を配置とは別に管理」
//
// ★誰を置いたかとは別に持つ。ここが埋まっていれば、配置が1件も無い日でも不足が出る。
//   「未設定」と「休み」と「0人」を同じ見た目にしない。
// ============================================================

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
/** 選択肢に出す人数の上限。これより大きい保存済みの値はそのまま残す */
const COUNT_CHOICES = 8;

type Baseline = { course_id: string; cycle_no: number; weekday: number; state: "working" | "closed"; required_count: number | null };
type Cycle = { cycle_no: number; label?: string | null; active?: boolean | null };
type Course = { id: string; name: string | null; uses_cycles?: boolean | null; archived_at?: string | null; course_cycles?: Cycle[] | null };

/** 未設定 = undefined / 休み = "closed" / 稼働 = 人数 */
type CellValue = number | "closed" | undefined;

const cellKey = (courseId: string, cycleNo: number, weekday: number) => `${courseId}|${cycleNo}|${weekday}`;

const valueLabel = (value: CellValue): string =>
  value === undefined ? "未設定" : value === "closed" ? "休み" : `${value}人`;

/** コース×便を「会社が動かす枠」に展開する（サーバーの framesOf と同じ規則） */
export function staffingFrames(courses: readonly Course[]): { courseId: string; courseName: string; cycleNo: number; label: string }[] {
  const frames: { courseId: string; courseName: string; cycleNo: number; label: string }[] = [];
  for (const course of courses) {
    if (course.archived_at) continue;
    const name = course.name ?? "";
    const cycles = (course.course_cycles ?? []).filter((c) => c.active !== false);
    if (course.uses_cycles && cycles.length > 0) {
      for (const cycle of cycles) {
        frames.push({ courseId: course.id, courseName: name, cycleNo: cycle.cycle_no, label: cycle.label ? `${name} ${cycle.label}` : `${name} ${cycle.cycle_no}便` });
      }
    } else {
      frames.push({ courseId: course.id, courseName: name, cycleNo: 0, label: name });
    }
  }
  return frames;
}

export function baselinesToCells(baselines: readonly Baseline[]): Record<string, CellValue> {
  const cells: Record<string, CellValue> = {};
  for (const row of baselines) {
    cells[cellKey(row.course_id, row.cycle_no, row.weekday)] =
      row.state === "closed" ? "closed" : row.required_count ?? undefined;
  }
  return cells;
}

/** 変わったセルだけを保存の形にする。未設定へ戻したセルは state:null で消す */
export function changedBaselines(
  current: Record<string, CellValue>,
  saved: Record<string, CellValue>,
): { courseId: string; cycleNo: number; weekday: number; state: "working" | "closed" | null; requiredCount: number | null }[] {
  const keys = new Set([...Object.keys(current), ...Object.keys(saved)]);
  const changes = [];
  for (const key of keys) {
    const value = current[key];
    if (value === saved[key]) continue;
    const [courseId, cycleNo, weekday] = key.split("|");
    changes.push({
      courseId,
      cycleNo: Number(cycleNo),
      weekday: Number(weekday),
      state: value === undefined ? null : value === "closed" ? ("closed" as const) : ("working" as const),
      requiredCount: typeof value === "number" ? value : null,
    });
  }
  return changes;
}

export default function ShiftStaffingSettingsModal({
  canWrite,
  courses,
  onDirtyChange,
  onClose,
}: {
  canWrite: boolean;
  courses: Course[];
  /** 未保存の変更があるか。閉じる操作を親が止められるようにする */
  onDirtyChange?: (dirty: boolean) => void;
  onClose?: () => void;
}) {
  const { data, refresh } = useApi<{ baselines: Baseline[]; unavailable?: boolean }>("/api/admin/shifts/requirements");
  const [cells, setCells] = useState<Record<string, CellValue>>({});
  const [saved, setSaved] = useState<Record<string, CellValue>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 取得のたびに編集中の内容を上書きしない。下の「特定の日だけ変える」の保存や
  // 再検証で再取得が走っても、未保存の曜日グリッドを黙って消さないため
  // （消えると「N件の変更」バッジも一緒に消え、失ったことに気づけない）
  const seeded = useRef(false);
  useEffect(() => {
    if (!data?.baselines) return;
    const next = baselinesToCells(data.baselines);
    setSaved(next);
    if (!seeded.current) {
      seeded.current = true;
      setCells(next);
    }
  }, [data]);

  const frames = useMemo(() => staffingFrames(courses), [courses]);
  const changes = useMemo(() => changedBaselines(cells, saved), [cells, saved]);

  useEffect(() => {
    onDirtyChange?.(changes.length > 0);
  }, [changes.length, onDirtyChange]);

  if (data?.unavailable) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <FontAwesomeIcon icon={faTriangleExclamation} className="mr-1.5 h-3 w-3" />
        必要人数の設定はまだ使えません
      </p>
    );
  }

  const save = async () => {
    if (changes.length === 0) return;
    setSaving(true);
    try {
      await apiFetch("/api/admin/shifts/requirements", { method: "PUT", body: JSON.stringify({ baselines: changes }) });
      setSaved(cells);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "必要人数を保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] text-xs">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-white px-1 py-1 text-left font-medium text-slate-500">コース・便</th>
              {WEEKDAYS.map((name, index) => (
                <th
                  key={name}
                  scope="col"
                  className={cn("px-1 py-1 text-center font-medium", index === 0 ? "text-red-500" : index === 6 ? "text-blue-500" : "text-slate-500")}
                >
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {frames.map((frame) => (
              <tr key={`${frame.courseId}|${frame.cycleNo}`} className="border-t border-slate-100">
                <th scope="row" className="sticky left-0 z-10 bg-white px-1 py-1 text-left font-medium text-slate-700">{frame.label}</th>
                {WEEKDAYS.map((name, weekday) => {
                  const key = cellKey(frame.courseId, frame.cycleNo, weekday);
                  const value = cells[key];
                  const extra = typeof value === "number" && value > COUNT_CHOICES ? [value] : [];
                  const tone = value === undefined
                    ? "border-amber-300 bg-amber-50 text-amber-800"
                    : value === "closed"
                      ? "border-slate-300 bg-slate-100 text-slate-600"
                      : "border-slate-200 bg-white text-slate-800";
                  return (
                    <td key={name} className="px-0.5 py-1">
                      {canWrite ? (
                        <select
                          aria-label={`${frame.label} ${name}曜の必要人数`}
                          value={value === undefined ? "" : value === "closed" ? "closed" : String(value)}
                          onChange={(event) => {
                            const raw = event.target.value;
                            setCells((prev) => ({
                              ...prev,
                              [key]: raw === "" ? undefined : raw === "closed" ? "closed" : Number(raw),
                            }));
                          }}
                          // ネイティブの矢印は文字の領域に重なって描かれ、padding では避けられない。
                          // appearance-none にして矢印を背景で置き、文字の幅を確実に残す
                          style={{
                            backgroundImage:
                              "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath fill='%2394a3b8' d='M0 0h10L5 6z'/%3E%3C/svg%3E\")",
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "right 3px center",
                            backgroundSize: "8px 5px",
                          }}
                          // 文字の幅ぎりぎりだと、フォント設定や他ブラウザで「未設定」が欠ける。左右の余白を詰めて余裕を作る
                          className={cn("min-h-11 w-full appearance-none rounded border pl-0.5 pr-3 text-center text-[11px] tabular-nums", tone)}
                        >
                          <option value="">未設定</option>
                          <option value="closed">休み</option>
                          {[...Array(COUNT_CHOICES + 1).keys(), ...extra].map((count) => (
                            <option key={count} value={count}>{count}人</option>
                          ))}
                        </select>
                      ) : (
                        // 閲覧のみ。操作できる見た目を出さず、値だけを示す
                        <div className={cn("flex min-h-11 items-center justify-center rounded border px-1 text-[11px] tabular-nums", tone)}>
                          {valueLabel(value)}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {frames.length === 0 && <p className="py-4 text-center text-xs text-slate-500">コースがありません</p>}

      {frames.length > 0 && (
        <ShiftStaffingExceptions
          canWrite={canWrite}
          frames={frames.map((f) => ({ courseId: f.courseId, cycleNo: f.cycleNo, label: f.label }))}
        />
      )}

      <div className="mt-3 flex items-center justify-end gap-3">
        {canWrite && changes.length > 0 && <span className="text-xs text-slate-500">{changes.length}件の変更</span>}
        {onClose && (
          <button type="button" onClick={onClose} className="min-h-11 px-3 text-xs text-slate-600">
            閉じる
          </button>
        )}
        {canWrite && (
          <button
            type="button"
            disabled={saving || changes.length === 0}
            onClick={() => void save()}
            className="min-h-11 rounded-lg bg-slate-900 px-5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        )}
      </div>

      <ErrorDialog open={!!error} message={error ?? ""} onClose={() => setError(null)} />
    </div>
  );
}
