"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { TimePicker } from "@/lib/ui/time-picker";
import { cycleLabel, nextCycleNo, type CourseCycle } from "@repo/core/logic/courseCycle";

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
};

export function CourseCyclesEditor({
  usesCycles,
  cycles,
  disabled,
  onUsesCyclesChange,
  onCyclesChange,
}: Props) {
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
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-semibold text-slate-700">運用単位</p>

      <div className="flex flex-col gap-1.5">
        {(
          [
            [false, "サイクルを使用しない"],
            [true, "サイクルを使用する"],
          ] as const
        ).map(([value, label]) => (
          <label key={String(value)} className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              checked={usesCycles === value}
              disabled={disabled}
              onChange={() => {
                onUsesCyclesChange(value);
                // 使うのに1つも無いと保存できないので、切り替えた時点で1便を用意する
                if (value && cycles.length === 0) add();
              }}
              className="h-4 w-4 accent-slate-800"
            />
            {label}
          </label>
        ))}
      </div>

      {usesCycles ? (
        <div className="space-y-2">
          {cycles.map((cycle) => (
            <div key={cycle.key} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">
                  {cycleLabel(cycle)}
                </span>
                <input
                  type="text"
                  value={cycle.label ?? ""}
                  disabled={disabled}
                  onChange={(e) => update(cycle.key, { label: e.target.value || null })}
                  placeholder={`${cycle.cycleNo}便`}
                  className="min-w-0 flex-1 rounded border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <button
                  type="button"
                  onClick={() => remove(cycle.key)}
                  disabled={disabled}
                  aria-label={`${cycleLabel(cycle)}を削除`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-red-600 disabled:opacity-40"
                >
                  <FontAwesomeIcon icon={faTrashCan} className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["meetingTime", "集合"],
                    ["arrivalTime", "開始"],
                    ["endTime", "終了目安"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <span className="mb-0.5 block text-xs text-slate-500">{label}</span>
                    <TimePicker
                      value={(cycle[key] as string | null) || null}
                      onChange={(v) => update(cycle.key, { [key]: v ?? "" })}
                      placeholder="--:--"
                      buttonClassName="px-2.5"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={cycle.meetingPlace ?? ""}
                  disabled={disabled}
                  onChange={(e) => update(cycle.key, { meetingPlace: e.target.value || null })}
                  placeholder="集合場所"
                  className="min-w-0 flex-1 rounded border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <input
                  type="number"
                  min={1}
                  value={cycle.maxDrivers ?? ""}
                  disabled={disabled}
                  onChange={(e) =>
                    update(cycle.key, {
                      maxDrivers: e.target.value === "" ? null : Math.max(1, Number(e.target.value)),
                    })
                  }
                  placeholder="人数"
                  className="w-24 rounded border border-slate-200 px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={add}
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-2.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
            サイクルを追加
          </button>
        </div>
      ) : null}
    </div>
  );
}
