"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DigitInput } from "@/lib/components/DigitInput";
import { cycleLabel, nextCycleNo, type CourseCycle } from "@repo/core/logic/courseCycle";
import { CourseTimeField } from "./CourseTimeField";

// ============================================================
// コースの「運用単位」— サイクル(便)を使うか、コース自身が時間を持つか。
// 設計: docs/design/course-cycle.md
//
//   使用しない: 時刻を便単位で管理しない単便コース
//   使用する  : 時間は便が持つ（豊中Amazon の 1便/2便/3便）
//
// 「便が無い」を空欄や0件で暗黙表現せず、切替として明示する。
// ★便を消してもシフト表の既存の割当は変わらない（設定は現在の定義であって過去の記録ではない）。
// ============================================================

export type CycleDraft = CourseCycle & { key: string };

/** DB の time 値（"HH:MM:SS"）を input type=time 用の "HH:MM" へ。 */
function toTimeInputValue(v: string | null | undefined): string {
  return v ? v.slice(0, 5) : "";
}

/** API から来た便を編集用の形にする。 */
export function toCycleDrafts(
  rows: {
    cycle_no: number;
    label?: string | null;
    meeting_place?: string | null;
    meeting_time?: string | null;
    arrival_time?: string | null;
    end_time?: string | null;
    max_drivers?: number | null;
  }[],
): CycleDraft[] {
  return rows
    .slice()
    .sort((a, b) => a.cycle_no - b.cycle_no)
    .map((r) => ({
      key: `c${r.cycle_no}`,
      cycleNo: r.cycle_no,
      label: r.label ?? null,
      meetingPlace: r.meeting_place ?? null,
      meetingTime: toTimeInputValue(r.meeting_time),
      arrivalTime: toTimeInputValue(r.arrival_time),
      endTime: toTimeInputValue(r.end_time),
      maxDrivers: r.max_drivers ?? null,
    }));
}

/** 保存用のペイロード。 */
export function toCyclePayload(cycles: CycleDraft[]) {
  return cycles.map((c) => ({
    cycleNo: c.cycleNo,
    label: c.label ?? null,
    meetingPlace: c.meetingPlace ?? null,
    meetingTime: c.meetingTime ?? null,
    arrivalTime: c.arrivalTime ?? null,
    endTime: c.endTime ?? null,
    maxDrivers: c.maxDrivers ?? null,
  }));
}

type Props = {
  usesCycles: boolean;
  cycles: CycleDraft[];
  disabled?: boolean;
  onUsesCyclesChange: (value: boolean) => void;
  onCyclesChange: (cycles: CycleDraft[]) => void;
  /** 単一運行時にコース本体へ保存する標準時刻。 */
  courseTimes: React.ReactNode;
  sectionRef?: React.RefObject<HTMLElement | null>;
};

export function CourseCyclesEditor({
  usesCycles,
  cycles,
  disabled,
  onUsesCyclesChange,
  onCyclesChange,
  courseTimes,
  sectionRef,
}: Props) {
  const reduceMotion = useReducedMotion();
  const motionTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const };
  const update = (key: string, patch: Partial<CourseCycle>) => {
    onCyclesChange(cycles.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  };

  const add = () => {
    const no = nextCycleNo(cycles);
    onCyclesChange([
      ...cycles,
      {
        key: `c${no}-${cycles.length}`,
        cycleNo: no,
        label: null,
        meetingPlace: null,
        meetingTime: "",
        arrivalTime: "",
        endTime: "",
        maxDrivers: null,
      },
    ]);
  };

  const remove = (key: string) => {
    onCyclesChange(cycles.filter((c) => c.key !== key));
  };

  return (
    <section
      ref={sectionRef}
      className="rounded-2xl border border-slate-200 bg-slate-50/45 p-5 sm:p-6"
      aria-labelledby="course-operation-heading"
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 id="course-operation-heading" className="text-base font-bold text-slate-900">運行設定</h2>
          <p className="mt-1 text-xs text-slate-400">時間と人数を運行単位で設定</p>
          <p className="mt-1 hidden text-[11px] text-slate-400 md:block">時刻は4桁でも入力できます（930 → 09:30）</p>
        </div>
        <div className="grid shrink-0 grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 text-xs" role="radiogroup" aria-label="運用単位">
          {(
            [
              [false, "サイクルを使用しない"],
              [true, "サイクルを使用する"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={String(value)}
              type="button"
              role="radio"
              aria-checked={usesCycles === value}
              disabled={disabled}
              onClick={() => {
                onUsesCyclesChange(value);
                // 使うのに1つも無いと保存できないので、切り替えた時点で1便を用意する
                if (value && cycles.length === 0) add();
              }}
              className={`rounded-md px-3 py-2 font-medium transition focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:opacity-40 ${usesCycles === value ? "bg-slate-800 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {usesCycles ? (
        <motion.div layout transition={motionTransition} className="space-y-3">
          <AnimatePresence initial={false}>
            {cycles.map((cycle, index) => (
              <motion.article
                layout
                key={cycle.key}
                data-flow-target
                initial={{ height: reduceMotion ? "auto" : 0, opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 10 }}
                animate={{ height: "auto", opacity: 1, y: 0 }}
                exit={{ height: 0, opacity: 0, y: -6 }}
                transition={motionTransition}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30"
              >
                <div className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-bold text-white">
                      C{index + 1}
                    </span>
                    <input
                      type="text"
                      value={cycle.label ?? ""}
                      disabled={disabled}
                      onChange={(e) => update(cycle.key, { label: e.target.value || null })}
                      placeholder={cycleLabel(cycle)}
                      aria-label={`C${index + 1}の名前`}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-800 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                    />
                    <button
                      type="button"
                      onClick={() => remove(cycle.key)}
                      disabled={disabled || cycles.length <= 1}
                      aria-label={`${cycleLabel(cycle)}を削除`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <FontAwesomeIcon icon={faTrashCan} className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {(
                      [
                        ["meetingTime", "集合"],
                        ["arrivalTime", "開始"],
                        ["endTime", "終了目安"],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key}>
                        <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
                        <CourseTimeField
                          value={(cycle[key] as string | null) || null}
                          onChange={(v) => update(cycle.key, { [key]: v ?? "" })}
                          disabled={disabled}
                          ariaLabel={`C${index + 1}の${label}時刻`}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_112px] gap-3">
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-xs font-medium text-slate-500">集合場所</span>
                      <input
                        type="text"
                        value={cycle.meetingPlace ?? ""}
                        disabled={disabled}
                        onChange={(e) => update(cycle.key, { meetingPlace: e.target.value || null })}
                        placeholder="集合場所"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-slate-500">人数</span>
                      <DigitInput
                        value={cycle.maxDrivers ?? null}
                        disabled={disabled}
                        onValueChange={(value) => update(cycle.key, { maxDrivers: value == null ? null : Math.max(1, value) })}
                        allowEmpty
                        placeholder="共通"
                        ariaLabel={`C${index + 1}の人数`}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                      />
                    </label>
                  </div>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>

          <motion.button
            layout
            transition={motionTransition}
            type="button"
            onClick={add}
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white/50 py-3 text-sm font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:opacity-40"
          >
            <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
            サイクルを追加
          </motion.button>
        </motion.div>
      ) : (
        <article data-flow-target className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/30">
          <div className="mb-3 text-xs font-bold text-slate-700">標準運行</div>
          {courseTimes}
        </article>
      )}
    </section>
  );
}
