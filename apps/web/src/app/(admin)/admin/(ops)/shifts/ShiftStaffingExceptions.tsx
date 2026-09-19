"use client";

import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { DatePicker } from "@/lib/components/DatePicker";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { cn } from "@/lib/ui/utils";

// ============================================================
// 特定の日だけ必要人数を変える（曜日の基準の例外）。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1
//
// 曜日の基準だけでは「この日は荷主の都合で増便」「この日は人数がまだ決まらない」を
// 表せない。**人数未確定はこの画面でしか作れない**（曜日の基準には未確定を置かない）。
// ============================================================

type StaffingState = "working" | "closed" | "undecided";

type Requirement = {
  shift_date: string;
  course_id: string;
  cycle_no: number;
  state: StaffingState;
  required_count: number | null;
};

type Frame = { courseId: string; cycleNo: number; label: string };

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const MAX_COUNT = 50;
/** 例外を出す範囲。曜日の基準と違い、過去の日を並べても直せることは無い */
const RANGE_DAYS = 90;

function toDateStr(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function jstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** 当年は「M月D日（曜）」、翌年以降は年を付ける（2月15日が来年の指定だと分からないため） */
export function dateLabel(date: string, thisYear?: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return date;
  const year = value.getUTCFullYear();
  const head = thisYear != null && year !== thisYear ? `${year}年` : "";
  return `${head}${value.getUTCMonth() + 1}月${value.getUTCDate()}日（${WEEKDAYS[value.getUTCDay()]}）`;
}

export function stateLabel(state: StaffingState, count: number | null): string {
  if (state === "closed") return "休み";
  if (state === "undecided") return "人数未確定";
  return `${count ?? 0}人`;
}

export default function ShiftStaffingExceptions({ canWrite, frames }: { canWrite: boolean; frames: Frame[] }) {
  const start = jstToday();
  const end = addDays(start, RANGE_DAYS);
  const { data, refresh } = useApi<{ requirements: Requirement[]; unavailable?: boolean }>(
    `/api/admin/shifts/requirements?start=${start}&end=${end}`,
  );

  const [date, setDate] = useState<Date | undefined>(undefined);
  const [frameKey, setFrameKey] = useState<string>("");
  const [state, setState] = useState<StaffingState>("working");
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 削除は取り消せないので確認を挟む（便の削除と同じ扱い）
  const [removing, setRemoving] = useState<Requirement | null>(null);
  const thisYear = new Date(`${start}T12:00:00Z`).getUTCFullYear();

  const rows = useMemo(
    () => [...(data?.requirements ?? [])].sort((a, b) => a.shift_date.localeCompare(b.shift_date)),
    [data],
  );
  const frameLabel = (courseId: string, cycleNo: number) =>
    frames.find((f) => f.courseId === courseId && f.cycleNo === cycleNo)?.label ?? "";

  if (data?.unavailable) return null;

  const send = async (body: unknown, onDone: () => void) => {
    setBusy(true);
    try {
      await apiFetch("/api/admin/shifts/requirements", { method: "PUT", body: JSON.stringify(body) });
      onDone();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const [courseIdPart, cyclePart] = frameKey ? frameKey.split("|") : ["", ""];
  // 同じ日・同じコース便の指定が既にあるなら上書きになる。ラベルでそう伝える
  const replacing =
    !!date &&
    !!frameKey &&
    rows.some((row) => row.shift_date === toDateStr(date) && row.course_id === courseIdPart && row.cycle_no === Number(cyclePart));

  const add = () => {
    if (!date || !frameKey) return;
    const [courseId, cycleNo] = frameKey.split("|");
    void send(
      {
        requirements: [
          {
            date: toDateStr(date),
            courseId,
            cycleNo: Number(cycleNo),
            state,
            requiredCount: state === "working" ? count : null,
          },
        ],
      },
      () => setDate(undefined),
    );
  };

  const remove = (row: Requirement) => {
    void send(
      {
        requirements: [
          { date: row.shift_date, courseId: row.course_id, cycleNo: row.cycle_no, state: null, requiredCount: null },
        ],
      },
      () => undefined,
    );
  };

  return (
    <section className="mt-5 border-t border-slate-100 pt-4">
      <h3 className="mb-2 text-xs font-bold text-slate-800">特定の日だけ変える</h3>

      {rows.length === 0 ? (
        <p className="py-2 text-xs text-slate-500">指定なし</p>
      ) : (
        <ul className="mb-3 divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={`${row.shift_date}|${row.course_id}|${row.cycle_no}`} className="flex items-center gap-2 py-1.5 text-xs">
              {/* 狭い幅では日付とコース名を2行にする（240px幅ではコース名が1文字まで潰れる） */}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                <span className="tabular-nums text-slate-700">{dateLabel(row.shift_date, thisYear)}</span>
                <span className="min-w-0 truncate text-slate-600">{frameLabel(row.course_id, row.cycle_no)}</span>
              </span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-medium",
                  row.state === "undecided" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700",
                )}
              >
                {stateLabel(row.state, row.required_count)}
              </span>
              {canWrite && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRemoving(row)}
                  aria-label={`${dateLabel(row.shift_date, thisYear)} ${frameLabel(row.course_id, row.cycle_no)} の指定を消す`}
                  className="inline-flex h-11 w-11 items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-40"
                >
                  <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <DatePicker
              value={date}
              onChange={setDate}
              ariaLabel="例外にする日"
              // 一覧の取得範囲と同じにする。先の日付を保存できても一覧に出ず、消せなくなる
              fromDate={new Date(`${start}T12:00:00Z`)}
              toDate={new Date(`${end}T12:00:00Z`)}
              displayFormat="M月d日（E）"
              className="h-11 w-full"
            />
          </div>
          <select
            aria-label="コース・便"
            value={frameKey}
            onChange={(event) => setFrameKey(event.target.value)}
            className="h-11 max-w-[12rem] rounded border border-slate-200 px-2 text-xs"
          >
            <option value="">コース・便</option>
            {frames.map((frame) => (
              <option key={`${frame.courseId}|${frame.cycleNo}`} value={`${frame.courseId}|${frame.cycleNo}`}>
                {frame.label}
              </option>
            ))}
          </select>
          <select
            aria-label="その日の扱い"
            value={state}
            onChange={(event) => setState(event.target.value as StaffingState)}
            className="h-11 rounded border border-slate-200 px-2 text-xs"
          >
            <option value="working">人数を指定</option>
            <option value="closed">休み</option>
            <option value="undecided">人数未確定</option>
          </select>
          {state === "working" && (
            <div className="flex items-center gap-1">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_COUNT}
                aria-label="必要人数"
                value={count}
                onChange={(event) => setCount(Math.min(MAX_COUNT, Math.max(0, Math.round(Number(event.target.value) || 0))))}
                className="h-11 w-16 rounded border border-slate-200 px-2 text-center text-xs tabular-nums"
              />
              <span className="text-xs text-slate-600">人</span>
            </div>
          )}
          <button
            type="button"
            disabled={busy || !date || !frameKey}
            onClick={add}
            className="min-h-11 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white disabled:opacity-40"
          >
            {replacing ? "変更" : "追加"}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!removing}
        title="この日の指定を消す"
        message={removing ? `${dateLabel(removing.shift_date, thisYear)} ${frameLabel(removing.course_id, removing.cycle_no)} は曜日の基準に戻ります。` : ""}
        confirmLabel="消す"
        onConfirm={() => {
          const row = removing;
          setRemoving(null);
          if (row) remove(row);
        }}
        onClose={() => setRemoving(null)}
      />
      <ErrorDialog open={!!error} message={error ?? ""} onClose={() => setError(null)} />
    </section>
  );
}
