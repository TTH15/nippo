"use client";

// 日報「内容」を送信画面と同じ動的構造(unit → group_label → fields)で描画する。
// 運営の日報一覧（未承認/すべて、PC表・スマホカード）で共用。

import {
  formatFieldValue,
  groupFieldsByLabel,
  type ReportContentUnit,
} from "@/lib/reportContent";

export function ReportContentView({
  units,
  muted,
}: {
  units?: ReportContentUnit[] | null;
  muted?: boolean;
}) {
  if (!units || units.length === 0) {
    return <span className="text-slate-400 text-xs">—</span>;
  }
  const valueCls = muted ? "text-slate-500" : "text-slate-900";
  return (
    <div className="space-y-1.5 text-left">
      {units.map((u) => {
        const groups = groupFieldsByLabel(u.fields);
        return (
          <div key={u.unitId}>
            {u.unitName && (
              <span className="text-[11px] font-semibold text-slate-500">{u.unitName}</span>
            )}
            <div className="space-y-0.5">
              {groups.map((g, gi) => (
                <div
                  key={`${u.unitId}-${gi}`}
                  className="text-[13px] flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
                >
                  {g.label && <span className="text-[11px] text-slate-400">{g.label}</span>}
                  {g.fields.map((f) => (
                    <span key={f.fieldKey}>
                      <span className="text-slate-500 text-xs">{f.label}</span>{" "}
                      <span className={`font-semibold tabular-nums ${valueCls}`}>
                        {formatFieldValue(f)}
                      </span>
                      {f.inputType === "INT" && <span className="text-slate-500 text-xs"> 個</span>}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
