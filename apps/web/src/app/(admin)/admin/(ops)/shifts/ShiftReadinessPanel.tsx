"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { useApi } from "@/lib/useApi";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { cn } from "@/lib/ui/utils";

// ============================================================
// 当日までに直さないと現場が止まるものを、締切より前に集めて出す。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1
//
// ★状態から毎回導く。閉じた印は持たないので、解決するまで消えない。
//   （閉じられる・消せる警告は、忙しい日ほど無視されて意味を失う）
// ============================================================

export const SHIFT_READINESS_KEY = "/api/admin/shifts/readiness";

type UnresolvedKind =
  | "baseline_missing"
  | "undecided"
  | "shortage"
  | "assigned_on_closed"
  | "unavailable"
  | "stale_confirmation"
  | "unconfirmed"
  | "source_mismatch"
  | "no_vehicle";

type UnresolvedItem = {
  kind: UnresolvedKind;
  date: string | null;
  courseId: string | null;
  cycleNo: number | null;
  driverId: string | null;
  dueDate: string | null;
  severity: "high" | "medium";
  detail: string;
};

type Response = {
  items: UnresolvedItem[];
  courseNames: Record<string, string>;
  cycleLabels: Record<string, string>;
  driverNames: Record<string, string>;
  today: string;
  unavailable: boolean;
};

const KIND_LABEL: Record<UnresolvedKind, string> = {
  unavailable: "対応不可",
  shortage: "人が足りない",
  assigned_on_closed: "休みの日に配置",
  source_mismatch: "原本と不一致",
  stale_confirmation: "要再確認",
  undecided: "人数未確定",
  unconfirmed: "未確認",
  no_vehicle: "配車未完了",
  baseline_missing: "基準未設定",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 利用者向けの日付はハイフン表記を出さない（M月D日（曜）） */
function dateLabel(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return date;
  return `${value.getUTCMonth() + 1}月${value.getUTCDate()}日（${WEEKDAYS[value.getUTCDay()]}）`;
}

function frameLabel(item: UnresolvedItem, data: Response): string {
  if (!item.courseId) return "";
  const course = data.courseNames[item.courseId] ?? "";
  const cycle = item.cycleNo != null ? data.cycleLabels[`${item.courseId}|${item.cycleNo}`] : undefined;
  return cycle ? `${course} ${cycle}` : course;
}

export default function ShiftReadinessPanel() {
  const { data } = useApi<Response>(SHIFT_READINESS_KEY, { revalidateOnFocus: true });
  const [open, setOpen] = useState(false);
  // 一覧が内部スクロールで切れているとき、続きがあることを示す。
  // 画面の大きさ・件数・スクロール位置で変わるので、そのたびに測り直す
  const [clipped, setClipped] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const itemCount = data?.items.length ?? 0;
  useEffect(() => {
    const node = listRef.current;
    if (!open || !node) {
      setClipped(false);
      return;
    }
    // 最下部まで読んだら手がかりは要らない
    const measure = () => setClipped(node.scrollHeight - node.scrollTop - node.clientHeight > 1);
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      node.removeEventListener("scroll", measure);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, itemCount]);

  const groups = useMemo(() => {
    const items = data?.items ?? [];
    const byDate = new Map<string, UnresolvedItem[]>();
    for (const item of items) {
      const key = item.date ?? "";
      const list = byDate.get(key);
      if (list) list.push(item);
      else byDate.set(key, [item]);
    }
    return [...byDate.entries()];
  }, [data]);

  if (!data || data.unavailable || data.items.length === 0) return null;

  const overdue = data.items.filter((item) => item.dueDate != null && item.dueDate < data.today);
  const high = data.items.filter((item) => item.severity === "high");
  // 0件の内訳は出さない（「要対応 0件」と書きながら警告を出し続けない）
  const summary = [
    `未解決 ${data.items.length}件`,
    overdue.length > 0 ? `期限切れ ${overdue.length}件` : high.length > 0 ? `要対応 ${high.length}件` : "",
  ].filter(Boolean).join("・");

  return (
    <section
      aria-label="予定の未解決"
      className={cn(
        "mb-3 rounded-xl border",
        overdue.length > 0 ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50",
      )}
    >
      {/* 見出しジャンプで届くよう、開閉トリガーを見出しに入れる */}
      <h2 className="m-0">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="shift-readiness-list"
          className="flex min-h-11 w-full items-center gap-2 rounded-t-xl px-3 py-2 text-left hover:bg-white/50"
        >
          <FontAwesomeIcon
            icon={faTriangleExclamation}
            className={cn("h-3.5 w-3.5", overdue.length > 0 ? "text-rose-600" : "text-amber-600")}
          />
          <span className="text-xs font-bold text-slate-800">{summary}</span>
          <FontAwesomeIcon
            icon={faChevronDown}
            className={cn("ml-auto h-3 w-3 text-slate-600 transition-transform", open && "rotate-180")}
          />
        </button>
      </h2>

      <SmoothCollapse open={open} id="shift-readiness-list">
        <div className="relative">
        <ul ref={listRef} className="max-h-[55vh] divide-y divide-white/70 overflow-y-auto border-t border-white/70">
          {groups.map(([date, items]) => (
            <li key={date || "frame"} className="px-3 py-2">
              <div className="mb-1 text-xs font-bold text-slate-800">
                {date ? dateLabel(date) : "コースの設定"}
              </div>
              <ul className="divide-y divide-black/5">
                {items.map((item, index) => {
                  const isOverdue = item.dueDate != null && item.dueDate < data.today;
                  const isDueToday = item.dueDate === data.today;
                  return (
                    <li
                      key={`${item.kind}-${item.courseId ?? ""}-${item.driverId ?? ""}-${index}`}
                      // 期限を独立した列に置く。狭い幅で本文が折り返しても、期限が単独行になって
                      // 次の項目のものに見えることがない
                      className="grid grid-cols-1 items-start gap-x-3 py-1 text-[11px] sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 font-bold",
                            item.severity === "high" ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-700",
                          )}
                        >
                          {KIND_LABEL[item.kind]}
                        </span>
                        <span className="text-slate-700">{frameLabel(item, data)}</span>
                        {item.driverId && <span className="text-slate-700">{data.driverNames[item.driverId] ?? ""}</span>}
                        <span className="text-slate-600">{item.detail}</span>
                      </span>
                      {item.dueDate && (
                        <span
                          className={cn(
                            "whitespace-nowrap tabular-nums sm:pt-0.5",
                            isOverdue ? "font-bold text-rose-700" : isDueToday ? "font-bold text-amber-700" : "text-slate-600",
                          )}
                        >
                          {isOverdue ? `期限切れ（${dateLabel(item.dueDate)}）` : isDueToday ? "今日まで" : `${dateLabel(item.dueDate)}まで`}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        {clipped && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t to-transparent",
              overdue.length > 0 ? "from-rose-50" : "from-amber-50",
            )}
          />
        )}
        </div>
      </SmoothCollapse>
    </section>
  );
}
