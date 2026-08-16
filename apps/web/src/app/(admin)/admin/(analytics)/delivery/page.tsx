"use client";

import { Fragment, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { DateRangePicker, type DateRangeValue } from "@/lib/components/DateRangePicker";
import { Skeleton } from "@/lib/components/Skeleton";
import { useApi } from "@/lib/useApi";
import {
  classifyCountField,
  perDriver,
  returnRate,
  type CountRole,
} from "@repo/core/logic/deliveryCounts";
import { formatMonthDayJP } from "@repo/core/logic/calendar";

// ============================================================
// 配達実績（個数の分析）。
// 売上ページが「金額」を見る場所なのに対し、ここは「個数」を見る場所。
//
// 個数は unit（宅急便・ネコポス…）× 報告項目（完了・持戻・時間帯別）で
// 会社ごとに自由に定義されるため、列も系列もすべて DB 由来で組み立てる
// （キャリア／ユニットのハードコードはしない）。
// ============================================================

type SummaryField = { key: string; label: string; groupLabel: string | null; isBillable: boolean };
type SummaryUnit = {
  id: string;
  name: string;
  billingType: string;
  carrierId: string | null;
  carrierName: string;
  fields: SummaryField[];
};
type Counts = { total: number; byDate: Record<string, number> };
type DriverCell = Counts & { fields?: Record<string, Counts> };

type Response = {
  units: SummaryUnit[];
  byDriver: Record<string, Record<string, DriverCell>>;
  byDate: Record<string, Record<string, Record<string, number>>>;
  byCourse: Record<string, Record<string, Record<string, number>>>;
  workDaysByDriver: Record<string, number>;
  courses: { id: string; name: string }[];
  drivers: { id: string; name: string }[];
};

/** グラフの系列色（unit 順にローテーション。売上ページと同じ落ち着いた階調） */
const SERIES_COLORS = ["#334155", "#64748b", "#475569", "#94a3b8", "#1e293b", "#7c8aa5", "#0f172a"];

const fmtCount = (n: number) => n.toLocaleString("ja-JP");
const fmtRate = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

/** 表示上のユニット名。同名 unit が複数キャリアにあるためキャリア名を添える。 */
function unitLabel(unit: SummaryUnit): string {
  return unit.carrierName ? `${unit.carrierName} ${unit.name}` : unit.name;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

/** Date → "YYYY-MM-DD"（ローカル暦日。UTC 変換で前日にずらさない）。 */
function toIso(date: Date | undefined): string {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function DeliveryPage() {
  const [range, setRange] = useState<DateRangeValue>({});
  const [expandedDriverId, setExpandedDriverId] = useState<string | null>(null);
  const [columnMode, setColumnMode] = useState<"total" | "fields">("total");

  const startIso = toIso(range.startDate);
  const endIso = toIso(range.endDate);
  const key =
    startIso && endIso
      ? `/api/admin/reports-summary?start=${startIso}&end=${endIso}&detail=1`
      : null;
  const { data, isInitialLoading } = useApi<Response>(key, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  const units = useMemo(() => data?.units ?? [], [data]);

  /** unit×項目 → 役割（完了/持戻/その他）。KPI と率の計算に使う。 */
  const roleOf = useMemo(() => {
    const map = new Map<string, CountRole>();
    for (const unit of units) {
      for (const field of unit.fields) {
        map.set(`${unit.id}:${field.key}`, classifyCountField(field));
      }
    }
    return map;
  }, [units]);

  /** unit ごとの完了・持戻の期間合計。 */
  const unitTotals = useMemo(() => {
    const totals = new Map<string, { completed: number; returned: number }>();
    for (const unit of units) totals.set(unit.id, { completed: 0, returned: 0 });
    for (const perUnit of Object.values(data?.byDate ?? {})) {
      for (const [unitId, fields] of Object.entries(perUnit)) {
        const cell = totals.get(unitId);
        if (!cell) continue;
        for (const [fieldKey, value] of Object.entries(fields)) {
          const role = roleOf.get(`${unitId}:${fieldKey}`);
          if (role === "completed") cell.completed += value;
          else if (role === "returned") cell.returned += value;
        }
      }
    }
    return totals;
  }, [data, units, roleOf]);

  const grandTotals = useMemo(() => {
    let completed = 0;
    let returned = 0;
    for (const t of unitTotals.values()) {
      completed += t.completed;
      returned += t.returned;
    }
    return { completed, returned };
  }, [unitTotals]);

  const activeDriverCount = Object.keys(data?.workDaysByDriver ?? {}).length;

  /** 日別の積み上げグラフ（系列＝unit の完了個数）。 */
  const chartData = useMemo(() => {
    const rows = Object.entries(data?.byDate ?? {})
      .map(([iso, perUnit]) => {
        const row: Record<string, string | number> = { iso, label: formatMonthDayJP(iso) };
        for (const unit of units) {
          let completed = 0;
          for (const [fieldKey, value] of Object.entries(perUnit[unit.id] ?? {})) {
            if (roleOf.get(`${unit.id}:${fieldKey}`) === "completed") completed += value;
          }
          row[unit.id] = completed;
        }
        return row;
      })
      .sort((a, b) => String(a.iso).localeCompare(String(b.iso)));
    return rows;
  }, [data, units, roleOf]);

  /** グラフに出す unit（期間内に完了個数があるものだけ）。 */
  const chartUnits = useMemo(
    () => units.filter((u) => (unitTotals.get(u.id)?.completed ?? 0) > 0),
    [units, unitTotals],
  );

  /** コース別の完了個数（多い順）。 */
  const courseRows = useMemo(() => {
    const nameById = new Map((data?.courses ?? []).map((c) => [c.id, c.name]));
    return Object.entries(data?.byCourse ?? {})
      .map(([courseId, perUnit]) => {
        const perUnitCompleted = new Map<string, number>();
        let total = 0;
        for (const [unitId, fields] of Object.entries(perUnit)) {
          let completed = 0;
          for (const [fieldKey, value] of Object.entries(fields)) {
            if (roleOf.get(`${unitId}:${fieldKey}`) === "completed") completed += value;
          }
          if (completed > 0) {
            perUnitCompleted.set(unitId, completed);
            total += completed;
          }
        }
        return { courseId, name: nameById.get(courseId) ?? "—", perUnitCompleted, total };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [data, roleOf]);

  // --- ドライバー別テーブルの列（合計 / 内訳） ---
  type Column = {
    key: string;
    unitId: string;
    label: string;
    groupName: string;
    fieldKey: string | null;
    asDays: boolean;
  };

  const usedUnits = useMemo(
    () =>
      units.filter((u) =>
        Object.values(data?.byDriver ?? {}).some((perUnit) => {
          const cell = perUnit[u.id];
          if (!cell) return false;
          return cell.total !== 0 || Object.values(cell.fields ?? {}).some((f) => f.total !== 0);
        }),
      ),
    [units, data],
  );

  const columns = useMemo<Column[]>(() => {
    if (columnMode === "fields") {
      const fieldColumns = usedUnits.flatMap((u) =>
        u.fields.map((f) => ({
          key: `${u.id}:${f.key}`,
          unitId: u.id,
          label: f.groupLabel ? `${f.groupLabel} ${f.label}` : f.label,
          groupName: unitLabel(u),
          fieldKey: f.key,
          asDays: false,
        })),
      );
      if (fieldColumns.length > 0) return fieldColumns;
    }
    return usedUnits.map((u) => ({
      key: u.id,
      unitId: u.id,
      label: u.name,
      groupName: u.carrierName || "その他",
      fieldKey: null,
      asDays: u.billingType === "FIXED",
    }));
  }, [columnMode, usedUnits]);

  const columnGroups = useMemo(() => {
    const groups: { key: string; label: string; span: number }[] = [];
    for (const col of columns) {
      const last = groups[groups.length - 1];
      if (last && last.label === col.groupName) last.span += 1;
      else groups.push({ key: col.key, label: col.groupName, span: 1 });
    }
    return groups;
  }, [columns]);

  const isBoundary = useMemo(
    () => columns.map((col, i) => i > 0 && columns[i - 1].groupName !== col.groupName),
    [columns],
  );

  const valueOf = (driverId: string, col: Column, iso?: string): number => {
    const cell = data?.byDriver[driverId]?.[col.unitId];
    if (!cell) return 0;
    const counts = col.fieldKey ? cell.fields?.[col.fieldKey] : cell;
    if (!counts) return 0;
    return (iso ? counts.byDate[iso] : counts.total) ?? 0;
  };

  const driverRows = useMemo(() => {
    const rows = data?.drivers ?? [];
    return rows
      .map((d) => ({
        ...d,
        workDays: data?.workDaysByDriver[d.id] ?? 0,
        sort: columns.reduce((sum, col) => sum + (col.asDays ? 0 : valueOf(d.id, col)), 0),
      }))
      .sort((a, b) => b.sort - a.sort || a.name.localeCompare(b.name, "ja"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, columns]);

  const columnTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const col of columns) {
      totals.set(col.key, driverRows.reduce((sum, d) => sum + valueOf(d.id, col), 0));
    }
    return totals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, driverRows, data]);

  const buildDailyDetail = (driverId: string) => {
    const dates = new Set<string>();
    for (const unit of usedUnits) {
      const cell = data?.byDriver[driverId]?.[unit.id];
      const buckets = [cell?.byDate, ...Object.values(cell?.fields ?? {}).map((f) => f.byDate)];
      for (const bucket of buckets) {
        for (const [iso, v] of Object.entries(bucket ?? {})) if (v) dates.add(iso);
      }
    }
    return Array.from(dates)
      .sort()
      .map((iso) => ({
        iso,
        label: formatMonthDayJP(iso),
        values: Object.fromEntries(columns.map((col) => [col.key, valueOf(driverId, col, iso)])),
      }));
  };

  const loading = isInitialLoading || !startIso;

  return (
    <AdminLayout>
      <div className="max-w-full space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-slate-900 md:text-xl">配達実績</h1>
          <DateRangePicker
            value={range}
            onChange={setRange}
            presets={["last_month", "current_month", "custom"]}
          />
        </div>

        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : units.length === 0 ? (
          <p className="py-12 text-sm text-slate-500">この期間に日報の実績がありません</p>
        ) : (
          <>
            {/* KPI */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="完了個数" value={fmtCount(grandTotals.completed)} sub="全ユニット合計" />
              <StatCard label="持戻個数" value={fmtCount(grandTotals.returned)} />
              <StatCard
                label="持戻率"
                value={fmtRate(returnRate(grandTotals))}
                sub="持戻 ÷（完了＋持戻）"
              />
              <StatCard
                label="1人あたり完了"
                value={(() => {
                  const v = perDriver(grandTotals.completed, activeDriverCount);
                  return v === null ? "—" : fmtCount(Math.round(v));
                })()}
                sub={`稼働 ${activeDriverCount} 人`}
              />
            </div>

            {/* ユニット別の内訳 */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {units.map((unit) => {
                const t = unitTotals.get(unit.id) ?? { completed: 0, returned: 0 };
                return (
                  <div key={unit.id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-400">{unit.carrierName}</p>
                    <p className="text-sm font-semibold text-slate-800">{unit.name}</p>
                    <p className="mt-2 text-xl font-bold tabular-nums text-slate-900">
                      {fmtCount(t.completed)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      持戻 {fmtCount(t.returned)}（{fmtRate(returnRate(t))}）
                    </p>
                  </div>
                );
              })}
            </div>

            {/* 個数推移 */}
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">個数の推移（完了）</h2>
              {chartUnits.length === 0 ? (
                <p className="py-8 text-sm text-slate-400">完了個数の記録がありません</p>
              ) : (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                        width={48}
                      />
                      <Tooltip
                        formatter={(value, name) => [`${fmtCount(Number(value) || 0)} 個`, String(name)]}
                        contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e2e8f0" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {chartUnits.map((unit, i) => (
                        <Bar
                          key={unit.id}
                          dataKey={unit.id}
                          name={unitLabel(unit)}
                          stackId="counts"
                          fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                          radius={i === chartUnits.length - 1 ? [3, 3, 0, 0] : undefined}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* コース別 */}
            {courseRows.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <h2 className="px-4 pb-2 pt-4 text-sm font-semibold text-slate-800">コース別（完了）</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-semibold">コース</th>
                        {chartUnits.map((u) => (
                          <th key={u.id} className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                            {u.name}
                          </th>
                        ))}
                        <th className="px-3 py-2.5 text-right font-semibold">合計</th>
                      </tr>
                    </thead>
                    <tbody>
                      {courseRows.map((row) => (
                        <tr key={row.courseId} className="border-t border-slate-100">
                          <td className="px-3 py-2.5 font-medium text-slate-900 whitespace-nowrap">
                            {row.name}
                          </td>
                          {chartUnits.map((u) => {
                            const v = row.perUnitCompleted.get(u.id) ?? 0;
                            return (
                              <td
                                key={u.id}
                                className={`px-3 py-2.5 text-right tabular-nums ${v ? "text-slate-900" : "text-slate-300"}`}
                              >
                                {v ? fmtCount(v) : "·"}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                            {fmtCount(row.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ドライバー別 */}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
                <h2 className="text-sm font-semibold text-slate-800">ドライバー別</h2>
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                  {(
                    [
                      ["total", "合計"],
                      ["fields", "内訳"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setColumnMode(mode)}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        columnMode === mode
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-slate-50 text-[11px] tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 pt-2.5 text-left font-semibold" />
                      {columnGroups.map((group) => (
                        <th
                          key={group.key}
                          colSpan={group.span}
                          className="border-l border-slate-200 px-3 pt-2.5 text-center font-semibold whitespace-nowrap text-slate-400"
                        >
                          {group.label}
                        </th>
                      ))}
                      <th className="border-l border-slate-200" colSpan={2} />
                    </tr>
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold">ドライバー</th>
                      {columns.map((col, i) => (
                        <th
                          key={col.key}
                          className={`px-3 py-2.5 text-right font-semibold whitespace-nowrap ${
                            isBoundary[i] ? "border-l border-slate-200" : ""
                          }`}
                        >
                          {col.label}
                        </th>
                      ))}
                      <th className="border-l border-slate-200 px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                        稼働日数
                      </th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {driverRows.map((drv) => {
                      const expanded = expandedDriverId === drv.id;
                      const detail = expanded ? buildDailyDetail(drv.id) : null;
                      return (
                        <Fragment key={drv.id}>
                          <tr
                            onClick={() => setExpandedDriverId(expanded ? null : drv.id)}
                            className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${expanded ? "bg-slate-50" : ""}`}
                          >
                            <td className="px-3 py-2.5 font-medium text-slate-900 whitespace-nowrap">
                              {drv.name}
                            </td>
                            {columns.map((col, i) => {
                              const v = valueOf(drv.id, col);
                              return (
                                <td
                                  key={col.key}
                                  className={`px-3 py-2.5 text-right tabular-nums ${
                                    v ? "font-semibold text-slate-900" : "text-slate-300"
                                  } ${isBoundary[i] ? "border-l border-slate-200" : ""}`}
                                >
                                  {v ? (col.asDays ? `${v}日` : fmtCount(v)) : "·"}
                                </td>
                              );
                            })}
                            <td className="border-l border-slate-200 px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                              {drv.workDays ? `${drv.workDays}日` : <span className="font-normal text-slate-300">·</span>}
                            </td>
                            <td className="pr-3 text-center text-slate-400">
                              <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} className="h-3 w-3" />
                            </td>
                          </tr>
                          {expanded && detail && (
                            <tr className="border-t border-slate-100 bg-slate-50/60">
                              <td colSpan={columns.length + 3} className="px-3 pb-3 pt-1">
                                {detail.length === 0 ? (
                                  <p className="py-2 text-xs text-slate-400">この期間の日別実績はありません</p>
                                ) : (
                                  <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                                    <table className="w-full min-w-[440px] text-xs">
                                      <thead className="bg-slate-50 text-[10px] tracking-wide text-slate-500">
                                        <tr>
                                          <th className="px-3 py-2 text-left font-semibold">日付</th>
                                          {columns.map((col, i) => (
                                            <th
                                              key={col.key}
                                              className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${
                                                isBoundary[i] ? "border-l border-slate-200" : ""
                                              }`}
                                            >
                                              {col.label}
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {detail.map((row) => (
                                          <tr key={row.iso} className="border-t border-slate-100">
                                            <td className="px-3 py-1.5 whitespace-nowrap text-slate-700">
                                              {row.label}
                                            </td>
                                            {columns.map((col, i) => {
                                              const v = row.values[col.key] ?? 0;
                                              return (
                                                <td
                                                  key={col.key}
                                                  className={`px-3 py-1.5 text-right tabular-nums ${
                                                    v ? "text-slate-900" : "text-slate-300"
                                                  } ${isBoundary[i] ? "border-l border-slate-200" : ""}`}
                                                >
                                                  {v ? fmtCount(v) : "·"}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                    <tr>
                      <td className="px-3 py-2.5 font-semibold text-slate-900">合計</td>
                      {columns.map((col, i) => {
                        const v = columnTotals.get(col.key) ?? 0;
                        return (
                          <td
                            key={col.key}
                            className={`px-3 py-2.5 text-right tabular-nums ${
                              v ? "font-semibold text-slate-900" : "text-slate-300"
                            } ${isBoundary[i] ? "border-l border-slate-200" : ""}`}
                          >
                            {v ? (col.asDays ? `${v}日` : fmtCount(v)) : "·"}
                          </td>
                        );
                      })}
                      <td className="border-l border-slate-200 px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                        {driverRows.reduce((s, d) => s + d.workDays, 0)}日
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
