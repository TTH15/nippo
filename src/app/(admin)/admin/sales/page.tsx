"use client";

import { useState, useMemo, useEffect, useRef, Fragment, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowTrendUp, faArrowTrendDown, faTrashCan, faPenToSquare, faRotateRight } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";
import { DateRangePicker, type DateRangeValue } from "@/lib/components/DateRangePicker";
import { DatePicker } from "@/lib/components/DatePicker";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { UnderlineTabs } from "@/lib/components/UnderlineTabs";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { reportDateDefaultJST } from "@/lib/date";
import { ChevronDown, Check } from "lucide-react";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch } from "@/lib/api";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import useSWR, { mutate as mutateSWR } from "swr";

type DataPoint = { iso: string; date: string; yamato: number; amazon: number; other: number; yamato_profit: number; amazon_profit: number; profit: number };
type DriverRow = { id: string; name: string; display_name?: string | null };
type CourseRow = { id: string; name: string; carrier?: "YAMATO" | "AMAZON" | "OTHER" | null; summary_title?: string | null };
type SummaryCourseRow = { id: string; name: string; summary_title: string };
type ReportRow = {
  driver_id: string;
  report_date: string;
  takuhaibin_completed: number;
  takuhaibin_returned: number;
  nekopos_completed: number;
  nekopos_returned: number;
};

type MidnightRow = {
  driver_id: string;
  date: string;
};

type Tab = "analytics" | "summary" | "log";

type SalesLogTypeRow = { id: string; name: string; sort_order: number };
type SalesLogEntryRow = {
  id: string;
  log_date: string;
  type_id: string;
  type_name: string;
  content: string;
  revenue: number;
  profit: number;
  attribution: "COMPANY" | "DRIVER";
  target_driver_id: string | null;
  target_driver_name: string | null;
  vehicle_id: string | null;
  vehicle_label: string | null;
  memo: string | null;
  counterparty_invoice_address_id: string | null;
  created_at: string;
  updated_at: string;
};
type InvoiceAddressOption = { id: string; name: string };
type VehicleRow = { id: string; manufacturer?: string | null; brand?: string | null; number_numeric?: string | null };

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const fmtSigned = (amount: number) => {
  const n = Number(amount);
  const sign = n >= 0 ? "+" : "−";
  return `${sign} ${Math.abs(n).toLocaleString("ja-JP")}`;
};

function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** コースをキャリア別にグループ化: ヤマト / Amazon / その他（DBの carrier を優先、未設定時は名前で判定） */
function groupCoursesByCarrier(courses: CourseRow[]): { label: string; courses: CourseRow[] }[] {
  const byCarrier = (carrier: "YAMATO" | "AMAZON" | "OTHER") =>
    courses.filter((c) => (c.carrier ?? (c.name.startsWith("ヤマト") ? "YAMATO" : c.name.startsWith("Amazon") || c.name.startsWith("アマゾン") ? "AMAZON" : "OTHER")) === carrier);
  const yamato = byCarrier("YAMATO");
  const amazon = byCarrier("AMAZON");
  const other = byCarrier("OTHER");
  const groups: { label: string; courses: CourseRow[] }[] = [];
  if (yamato.length > 0) groups.push({ label: "ヤマト", courses: yamato });
  if (amazon.length > 0) groups.push({ label: "Amazon", courses: amazon });
  if (other.length > 0) groups.push({ label: "その他", courses: other });
  return groups;
}

function CourseSelect({
  courses,
  value,
  onChange,
  disabled,
}: {
  courses: CourseRow[];
  value: Set<string>;
  onChange: (ids: Set<string>) => void;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupCoursesByCarrier(courses), [courses]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleCourse = (id: string) => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const selectAllInGroup = (groupCourses: CourseRow[], select: boolean) => {
    const next = new Set(value);
    groupCourses.forEach((c) => (select ? next.add(c.id) : next.delete(c.id)));
    onChange(next);
  };

  const label =
    value.size === 0
      ? "対象コース"
      : value.size === courses.length
        ? "すべてのコース"
        : `対象コース (${value.size})`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((o) => !o)}
        disabled={disabled}
        className={`
          inline-flex items-center justify-between gap-1.5 px-3 py-1.5 min-w-[140px] text-left
          text-xs font-medium bg-white border-2 border-slate-200 rounded-xl
          transition-all duration-200
          ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-slate-300 focus:border-slate-500 focus:outline-none focus:ring-4 focus:ring-slate-100"}
          ${isOpen ? "border-slate-500 ring-4 ring-slate-100" : ""}
        `}
      >
        <span className={value.size === 0 ? "text-slate-500" : "text-slate-900"}>{label}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && (
        <div
          className="absolute z-[9999] left-0 mt-2 w-64 bg-white border-2 border-slate-200 rounded-xl shadow-xl overflow-hidden"
          role="listbox"
        >
          <div className="max-h-[320px] overflow-y-auto py-2">
            {courses.length === 0 ? (
              <div className="px-4 py-3 text-slate-400 text-sm">読み込み中...</div>
            ) : (
              groups.map((group) => {
                const ids = group.courses.map((c) => c.id);
                const selectedInGroup = ids.filter((id) => value.has(id)).length;
                const allSelected = selectedInGroup === ids.length;
                const someSelected = selectedInGroup > 0;
                return (
                  <div key={group.label} className="mb-2 last:mb-0">
                    <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 border-b border-slate-100">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) (el as HTMLInputElement & { indeterminate: boolean }).indeterminate = someSelected && !allSelected;
                        }}
                        onChange={() => selectAllInGroup(group.courses, !allSelected)}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                      />
                      <span className="text-xs font-semibold text-slate-700">{group.label} をすべて</span>
                    </label>
                    {group.courses.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 text-sm text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={value.has(c.id)}
                          onChange={() => toggleCourse(c.id)}
                          className="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                        />
                        <span className="flex-1 min-w-0 truncate">{c.name}</span>
                        {value.has(c.id) && <Check className="w-4 h-4 text-slate-600 flex-shrink-0" />}
                      </label>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const isProfit = (name: string) => name.includes("利益");
  const revenueItems = payload.filter((p) => !isProfit(p.name));
  const profitItems = payload.filter((p) => isProfit(p.name));
  const totalRevenue = revenueItems.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-4 py-3 text-sm">
      <p className="font-medium text-slate-900 mb-1.5">{label}</p>
      {revenueItems.map((entry, i) => (
        <div key={`rev-${i}`} className="flex items-center gap-2 py-0.5">
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-600">{entry.name}</span>
          <span className="ml-auto font-medium text-slate-900 pl-4">{fmt(entry.value)}</span>
        </div>
      ))}
      {revenueItems.length > 0 && (
        <div className="flex items-center gap-2 pt-1.5 mt-1 border-t border-slate-100">
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-slate-200" />
          <span className="text-slate-600 font-medium">売上合計</span>
          <span className="ml-auto font-semibold text-slate-900 pl-4">{fmt(totalRevenue)}</span>
        </div>
      )}
      {profitItems.length > 0 && <div className="my-2 border-t border-slate-200" />}
      {profitItems.map((entry, i) => (
        <div key={`profit-${i}`} className="flex items-center gap-2 py-0.5">
          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-600">{entry.name}</span>
          <span className="ml-auto font-medium text-slate-900 pl-4">{fmt(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

function LogEntryModal({
  open,
  onClose,
  startIso,
  editingEntry,
  logTypes,
  drivers,
  vehicles,
  invoiceAddresses,
  onSaved,
  onTypeAdded,
}: {
  open: boolean;
  onClose: () => void;
  startIso: string;
  editingEntry: SalesLogEntryRow | null;
  logTypes: SalesLogTypeRow[];
  drivers: DriverRow[];
  vehicles: VehicleRow[];
  invoiceAddresses: InvoiceAddressOption[];
  onSaved: () => void;
  onTypeAdded: () => void;
}) {
  const [logDate, setLogDate] = useState("");
  const [typeId, setTypeId] = useState("");
  const [content, setContent] = useState("");
  const [revenueValue, setRevenueValue] = useState<string>("");
  const [profitValue, setProfitValue] = useState<string>("");
  const [targetDriverId, setTargetDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [memo, setMemo] = useState("");
  const [counterpartyInvoiceAddressId, setCounterpartyInvoiceAddressId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [newTypeName, setNewTypeName] = useState("");
  const [addingType, setAddingType] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingEntry) {
        setLogDate(editingEntry.log_date || "");
        setTypeId(editingEntry.type_id || "");
        setContent(editingEntry.content || "");
        setRevenueValue(String(editingEntry.revenue ?? ""));
        setProfitValue(String(editingEntry.profit ?? ""));
        setTargetDriverId(editingEntry.target_driver_id || "");
        setVehicleId(editingEntry.vehicle_id || "");
        setMemo(editingEntry.memo ?? "");
        setCounterpartyInvoiceAddressId(editingEntry.counterparty_invoice_address_id ?? "");
        setInputError(null);
      } else {
        setLogDate(toLocalYmd(new Date()));
        setTypeId("");
        setContent("");
        setRevenueValue("");
        setProfitValue("");
        setTargetDriverId("");
        setVehicleId("");
        setMemo("");
        setCounterpartyInvoiceAddressId("");
        setInputError(null);
      }
    }
  }, [open, startIso, editingEntry]);

  const vehicleLabel = (v: VehicleRow) => [v.manufacturer, v.brand, v.number_numeric].filter(Boolean).join(" ") || v.id;
  const dateValue = logDate ? new Date(logDate + "T12:00:00") : undefined;
  const previewRevenue = Math.max(0, Math.trunc(Number(revenueValue) || 0));
  const previewProfit = Math.trunc(Number(profitValue) || 0);
  const driverRewardPreview = Math.max(0, previewRevenue - previewProfit);

  const handleSave = () => {
    if (!logDate || !typeId || content.trim() === "") return;
    setInputError(null);
    const revenue = Math.max(0, Math.trunc(Number(revenueValue) || 0));
    const profit = Math.trunc(Number(profitValue) || 0);
    if (revenue === 0 && profit === 0) {
      setInputError("売上または利益を入力してください");
      return;
    }
    if (revenue < 0) {
      setInputError("売上は0以上で入力してください");
      return;
    }
    if (profit > revenue) {
      setInputError("利益が売上を超えています。入力を確認してください");
      return;
    }
    setSubmitting(true);
    const req = editingEntry
      ? apiFetch(`/api/admin/sales/log/${editingEntry.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            log_date: logDate,
            type_id: typeId,
            content: content.trim(),
            revenue,
            profit,
            target_driver_id: targetDriverId || null,
            vehicle_id: vehicleId || null,
            memo: memo.trim() || null,
            counterparty_invoice_address_id: counterpartyInvoiceAddressId.trim() || null,
          }),
        })
      : apiFetch("/api/admin/sales/log", {
          method: "POST",
          body: JSON.stringify({
            log_date: logDate,
            type_id: typeId,
            content: content.trim(),
            revenue,
            profit,
            target_driver_id: targetDriverId || null,
            vehicle_id: vehicleId || null,
            memo: memo.trim() || null,
            counterparty_invoice_address_id: counterpartyInvoiceAddressId.trim() || null,
          }),
        });

    req
      .then(() => {
        onSaved();
        onClose();
      })
      .catch(() => { })
      .finally(() => setSubmitting(false));
  };

  const handleAddType = () => {
    const name = newTypeName.trim();
    if (!name) return;
    setAddingType(true);
    apiFetch("/api/admin/sales/log/types", {
      method: "POST",
      body: JSON.stringify({ name }),
    })
      .then(() => {
        setNewTypeName("");
        onTypeAdded();
      })
      .catch(() => { })
      .finally(() => setAddingType(false));
  };

  if (!open) return null;

  const inputClass = "h-12 px-3 border border-slate-200 rounded-xl text-sm w-full";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 px-5 py-4 flex items-center justify-between rounded-t-xl">
          <h2 className="text-base font-semibold text-slate-900">{editingEntry ? "ログを編集" : "ログを追加"}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1" aria-label="閉じる">×</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">日付</label>
              <DatePicker
                value={dateValue}
                onChange={(d) => setLogDate(d ? toLocalYmd(d) : "")}
                placeholder="日付を選択"
                className="h-12 w-full"
              />
            </div>
            <div className="sm:col-span-2 min-w-0 overflow-hidden">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">種別</label>
              <div className="flex flex-wrap gap-2 items-stretch min-w-0">
                <div className="flex-1 min-w-[120px] basis-40">
                  <CustomSelect
                    size="md"
                    options={logTypes.map((t) => ({ value: t.id, label: t.name }))}
                    value={typeId}
                    onChange={setTypeId}
                    placeholder="選択"
                    clearable
                  />
                </div>
                <input
                  type="text"
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  placeholder="種別を追加"
                  className={`flex-1 min-w-[80px] max-w-[140px] rounded-xl ${inputClass}`}
                />
                <button type="button" onClick={handleAddType} disabled={addingType || !newTypeName.trim()} className="h-12 px-3 shrink-0 bg-slate-100 rounded-xl text-sm font-medium hover:bg-slate-200 disabled:opacity-50 whitespace-nowrap">追加</button>
              </div>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">内容</label>
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="例: ヤマト宅急便 3/1分"
                className={inputClass}
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">売上 / 利益</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={0}
                  value={revenueValue}
                  onChange={(e) => setRevenueValue(e.target.value)}
                  placeholder="売上"
                  className={`min-w-0 text-right tabular-nums ${inputClass}`}
                />
                <input
                  type="number"
                  value={profitValue}
                  onChange={(e) => setProfitValue(e.target.value)}
                  placeholder="利益（マイナス可）"
                  className={`min-w-0 text-right tabular-nums ${inputClass}`}
                />
              </div>
              {targetDriverId && (
                <p className="mt-1 text-[11px] text-slate-600">
                  対象ドライバーへの報酬反映: {fmt(driverRewardPreview)}
                  （売上 - 利益）
                </p>
              )}
              {inputError && <p className="mt-1 text-xs text-red-600">{inputError}</p>}
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                取引先（請求先）— 取引先画面・請求ドラフトに反映
              </label>
              <CustomSelect
                size="md"
                options={[
                  { value: "", label: "（未設定）" },
                  ...invoiceAddresses.map((a) => ({ value: a.id, label: a.name })),
                ]}
                value={counterpartyInvoiceAddressId}
                onChange={setCounterpartyInvoiceAddressId}
                placeholder="（未設定）"
                clearable
              />
              <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                単発案件など、コース外の売上を特定の取引先に紐づけるときに指定します。利益がマイナスのときは取引先の「控除」に載ります。
              </p>
            </div>
            <div className="sm:col-span-2 lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="min-w-0">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">対象者</label>
                <CustomSelect
                  size="md"
                  options={[{ value: "", label: "（該当者なし）" }, ...drivers.map((d) => ({ value: d.id, label: d.display_name ?? d.name }))]}
                  value={targetDriverId}
                  onChange={setTargetDriverId}
                  placeholder="（該当者なし）"
                  clearable
                />
                <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                  ドライバーを選び、売上・利益を入力すると、差額（売上−利益）がその月のペイメントの臨時経費「＋」（手当）として反映されます。
                </p>
              </div>
              <div className="min-w-0">
                <label className="block text-xs font-medium text-slate-600 mb-1.5">車両</label>
                <CustomSelect
                  size="md"
                  options={[{ value: "", label: "（該当車両なし）" }, ...vehicles.map((v) => ({ value: v.id, label: vehicleLabel(v) }))]}
                  value={vehicleId}
                  onChange={setVehicleId}
                  placeholder="（該当車両なし）"
                  clearable
                />
              </div>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">備考</label>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="任意"
                className={inputClass}
              />
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 flex justify-end gap-2 rounded-b-xl">
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting || !logDate || !typeId || content.trim() === ""}
            className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? (editingEntry ? "更新中..." : "追加中...") : (editingEntry ? "更新" : "登録")}
          </button>
        </div>
      </div>
    </div>
  );
}

type LogRow =
  | { kind: "calculated"; type_name: string; content: string; revenue: number; profit: number }
  | { kind: "entry"; entry: SalesLogEntryRow };

function LogEntriesByDate({
  entries,
  displayData,
  daysInRange,
  canWrite,
  logTypes,
  drivers,
  vehicles,
  invoiceAddressById,
  startIso,
  endIso,
  onUpdated,
  onEdit,
  onRequestDelete,
  savingId,
  setSavingId,
}: {
  entries: SalesLogEntryRow[];
  displayData: DataPoint[];
  daysInRange: { iso: string; label: string }[];
  canWrite: boolean;
  logTypes: SalesLogTypeRow[];
  drivers: DriverRow[];
  vehicles: VehicleRow[];
  invoiceAddressById: Record<string, string>;
  startIso: string;
  endIso: string;
  onUpdated: () => void;
  onEdit: (entry: SalesLogEntryRow) => void;
  onRequestDelete: (entry: SalesLogEntryRow) => void;
  savingId: string | null;
  setSavingId: (id: string | null) => void;
}) {
  const vehicleLabel = (v: VehicleRow) => [v.manufacturer, v.brand, v.number_numeric].filter(Boolean).join(" ") || v.id;

  const entriesByDate = useMemo(() => {
    const map = new Map<string, SalesLogEntryRow[]>();
    entries.forEach((e) => {
      const list = map.get(e.log_date) ?? [];
      list.push(e);
      map.set(e.log_date, list);
    });
    return map;
  }, [entries]);

  const [filterTypeId, setFilterTypeId] = useState("");
  const [sortDateOrder, setSortDateOrder] = useState<"desc" | "asc">("desc");

  const byDate = useMemo((): [string, LogRow[]][] => {
    const out: [string, LogRow[]][] = [];
    daysInRange.forEach((day, i) => {
      const sales = displayData[i];
      const yamato = sales?.yamato ?? 0;
      const amazon = sales?.amazon ?? 0;
      const yamatoProfit = sales?.yamato_profit ?? 0;
      const amazonProfit = sales?.amazon_profit ?? 0;
      const dayEntries = entriesByDate.get(day.iso) ?? [];
      const rows: LogRow[] = [];
      if (yamato > 0 || yamatoProfit !== 0) rows.push({ kind: "calculated", type_name: "ヤマト", content: "日報集計", revenue: yamato, profit: yamatoProfit });
      if (amazon > 0 || amazonProfit !== 0) rows.push({ kind: "calculated", type_name: "Amazon", content: "日報集計", revenue: amazon, profit: amazonProfit });
      dayEntries.forEach((e) => rows.push({ kind: "entry", entry: e }));
      let filtered = rows;
      if (filterTypeId) filtered = filtered.filter((r) => r.kind === "calculated" || r.entry.type_id === filterTypeId);
      if (filtered.length > 0) out.push([day.iso, filtered]);
    });
    return out.sort((a, b) => (sortDateOrder === "desc" ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])));
  }, [daysInRange, displayData, entriesByDate, filterTypeId, sortDateOrder]);

  const dateLabel = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${m}月${d}日`;
  };

  const handleDelete = (entry: SalesLogEntryRow) => {
    if (!canWrite) return;
    onRequestDelete(entry);
  };

  return (
    <div>
      {/* フィルター・並べ替えは常時表示 */}
      <div className="flex flex-wrap items-center gap-4 m-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">種別</span>
          <CustomSelect
            size="sm"
            options={[{ value: "", label: "すべて" }, ...logTypes.map((t) => ({ value: t.id, label: t.name }))]}
            value={filterTypeId}
            onChange={setFilterTypeId}
            placeholder="すべて"
            clearable={false}
            className="min-w-[100px]"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">並べ替え</span>
          <CustomSelect
            size="sm"
            options={[
              { value: "desc", label: "日付 降順" },
              { value: "asc", label: "日付 昇順" },
            ]}
            value={sortDateOrder}
            onChange={(v) => setSortDateOrder(v as "desc" | "asc")}
            placeholder="日付 降順"
            clearable={false}
            className="min-w-[110px]"
          />
        </div>
      </div>
      {byDate.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-500">
          {entries.length === 0 && !filterTypeId
            ? "この期間にログがありません。右上の「新規追加」から登録するか、日付範囲を変更してください。"
            : "該当するログがありません。フィルターを変更するか、日付範囲を確認してください。"}
        </div>
      ) : (
        <div>
          {byDate.map(([dateIso, rows]) => (
            <div key={dateIso} className="border-b border-slate-100 last:border-b-0">
              <div className="px-3 py-2 bg-slate-50 font-semibold text-slate-800 text-sm">
                {dateLabel(dateIso)}
              </div>
              <div className="overflow-x-auto table-scroll table-scroll-fade -mx-1 md:mx-0">
                <table className="w-full text-xs table-fixed min-w-[800px] md:min-w-0">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80">
                    <th className="sticky left-0 z-20 bg-slate-50/80 px-3 py-2 text-left font-medium text-slate-600 w-20">種別</th>
                    <th className="sticky left-[80px] z-20 bg-slate-50/80 px-3 py-2 text-left font-medium text-slate-600 w-[12ch]">内容</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600 w-24">売上</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600 w-24">利益</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600 w-24">対象者</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600 w-28">車両</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600 w-28">取引先</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600 min-w-[200px]">備考</th>
                    {canWrite && <th className="px-3 py-2 w-20" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIdx) => {
                    if (row.kind === "calculated") {
                      return (
                        <tr key={`calc-${dateIso}-${rowIdx}`} className="border-t border-slate-100 bg-slate-50/30">
                          <td className="sticky left-0 z-10 bg-slate-50/30 px-3 py-2 font-medium text-slate-800">{row.type_name}</td>
                          <td className="sticky left-[80px] z-10 bg-slate-50/30 px-3 py-2 text-slate-600 truncate">{row.content}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">{fmt(row.revenue)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-medium ${row.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmtSigned(row.profit)}</td>
                          <td className="px-3 py-2 text-slate-500">—</td>
                          <td className="px-3 py-2 text-slate-500">—</td>
                          <td className="px-3 py-2 text-slate-500">—</td>
                          <td className="px-3 py-2 text-slate-400 text-[11px]">—</td>
                          {canWrite && <td className="px-3 py-2" />}
                        </tr>
                      );
                    }
                    const r = row.entry;
                    const saving = savingId === r.id;
                    return (
                      <tr
                        key={r.id}
                        className="border-t border-slate-100 hover:bg-slate-50/50"
                      >
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-800">{r.type_name}</td>
                        <td className="sticky left-[80px] z-10 bg-white px-3 py-2 text-slate-700 truncate max-w-[12ch]">{r.content}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                          {fmt(r.revenue)}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {fmtSigned(r.profit)}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{r.target_driver_name ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{r.vehicle_label ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600 truncate max-w-[7rem]" title={r.counterparty_invoice_address_id ? invoiceAddressById[r.counterparty_invoice_address_id] : undefined}>
                          {r.counterparty_invoice_address_id
                            ? invoiceAddressById[r.counterparty_invoice_address_id] ?? "—"
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-500 text-[11px]">{r.memo ?? "—"}</td>
                        {canWrite && (
                          <td className="px-3 py-2">
                            {saving ? (
                              <span className="text-slate-400 text-[10px]">保存中...</span>
                            ) : (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => onEdit(r)}
                                  className="text-slate-400 hover:text-slate-800 text-[11px]"
                                  title="編集"
                                >
                                  <FontAwesomeIcon icon={faPenToSquare} className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(r)}
                                  className="text-slate-400 hover:text-red-600 text-[11px]"
                                  title="削除"
                                >
                                  <FontAwesomeIcon icon={faTrashCan} className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SalesPage() {
  const [tab, setTab] = useState<Tab>("analytics");
  const [range, setRange] = useState<DateRangeValue | undefined>();
  const [deliveryData, setDeliveryData] = useState<DataPoint[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [midnights, setMidnights] = useState<MidnightRow[]>([]);
  const [summaryCourses, setSummaryCourses] = useState<SummaryCourseRow[]>([]);
  const [courseShifts, setCourseShifts] = useState<Record<string, { driver_id: string; date: string }[]>>({});
  const [prevTotals, setPrevTotals] = useState<{ total: number; profit: number } | null>(null);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [logEntries, setLogEntries] = useState<SalesLogEntryRow[]>([]);
  const [logTypes, setLogTypes] = useState<SalesLogTypeRow[]>([]);
  const [logDrivers, setLogDrivers] = useState<DriverRow[]>([]);
  const [logVehicles, setLogVehicles] = useState<VehicleRow[]>([]);
  const [logInvoiceAddresses, setLogInvoiceAddresses] = useState<InvoiceAddressOption[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [logSavingId, setLogSavingId] = useState<string | null>(null);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logEditingEntry, setLogEditingEntry] = useState<SalesLogEntryRow | null>(null);
  const [logDeleteTarget, setLogDeleteTarget] = useState<SalesLogEntryRow | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [selectedDayIso, setSelectedDayIso] = useState<string>("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
  }, []);

  const { data: coursesData } = useSWR<{ courses: CourseRow[] }>(
    "/api/admin/courses",
    (url: string) => apiFetch<{ courses: CourseRow[] }>(url),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30 * 60 * 1000,
    },
  );
  useEffect(() => {
    if (coursesData) setCourses(coursesData.courses ?? []);
  }, [coursesData]);

  const debouncedSelectedDriverId = useDebouncedValue(selectedDriverId, 400);
  const debouncedCourseIds = useDebouncedValue(
    Array.from(selectedCourseIds).sort().join(","),
    400,
  );

  const courseIdsQuery =
    debouncedCourseIds.length > 0
      ? `&course_ids=${debouncedCourseIds}`
      : "";
  const driverIdQuery = debouncedSelectedDriverId ? `&driver_id=${debouncedSelectedDriverId}` : "";
  const salesFilterQuery = `${courseIdsQuery}${driverIdQuery}`;

  // URL のクエリ (?tab=summary など) から初期タブを決定（クライアント側でのみ実行）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t === "summary") setTab("summary");
    else if (t === "log") setTab("log");
  }, []);

  const startIso = useMemo(
    () => (range?.startDate ? toLocalYmd(range.startDate) : ""),
    [range?.startDate],
  );
  const endIso = useMemo(
    () => (range?.endDate ? toLocalYmd(range.endDate) : ""),
    [range?.endDate],
  );

  useEffect(() => {
    if (!startIso || !endIso) return;
    const businessToday = reportDateDefaultJST();
    // 期間変更時は「現在選択日が期間内なら維持、期間外なら業務日/末日にクランプ」
    setSelectedDayIso((prev) => {
      if (prev && prev >= startIso && prev <= endIso) return prev;
      if (businessToday >= startIso && businessToday <= endIso) return businessToday;
      return endIso; // 期間外なら末日に寄せる
    });
  }, [startIso, endIso]);

  const prevRange = useMemo(() => {
    if (!startIso || !endIso) return null;
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null;
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1) || 1;
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (days - 1));
    return { prevStartIso: toLocalYmd(prevStart), prevEndIso: toLocalYmd(prevEnd) };
  }, [startIso, endIso]);

  const salesKey = startIso && endIso ? `/api/admin/sales?start=${startIso}&end=${endIso}${salesFilterQuery}` : null;
  const prevSalesKey =
    prevRange != null
      ? `/api/admin/sales?start=${prevRange.prevStartIso}&end=${prevRange.prevEndIso}${salesFilterQuery}`
      : null;

  const { data: salesDataRes, isLoading: salesLoading } = useSWR<{ data: DataPoint[] }>(
    salesKey,
    (url: string) => apiFetch<{ data: DataPoint[] }>(url),
    {
      revalidateOnFocus: false,
      dedupingInterval: 10 * 60 * 1000,
      keepPreviousData: true,
    },
  );
  useEffect(() => {
    setDeliveryData(salesDataRes?.data ?? []);
  }, [salesDataRes]);
  useEffect(() => {
    if (salesDataRes) {
      setLastUpdatedAt(Date.now());
      setElapsedSec(0);
    }
  }, [salesDataRes]);
  useEffect(() => {
    setLoadingAnalytics(salesLoading);
  }, [salesLoading]);

  const { data: prevSalesDataRes, isLoading: prevSalesLoading } = useSWR<{ data: DataPoint[] }>(
    prevSalesKey,
    (url: string) => apiFetch<{ data: DataPoint[] }>(url),
    {
      revalidateOnFocus: false,
      dedupingInterval: 10 * 60 * 1000,
      keepPreviousData: true,
    },
  );
  useEffect(() => {
    const data = prevSalesDataRes?.data ?? [];
    if (data.length === 0) {
      setPrevTotals(null);
      return;
    }
    const yamato = data.reduce((s, d) => s + d.yamato, 0);
    const amazon = data.reduce((s, d) => s + d.amazon, 0);
    const profit = data.reduce((s, d) => s + d.profit, 0);
    setPrevTotals({ total: yamato + amazon, profit });
  }, [prevSalesDataRes]);
  useEffect(() => {
    setLoadingPrev(prevSalesLoading);
  }, [prevSalesLoading]);

  const refreshSalesCaches = useCallback(async () => {
    const tasks: Promise<unknown>[] = [];
    if (salesKey) tasks.push(mutateSWR(salesKey));
    if (prevSalesKey) tasks.push(mutateSWR(prevSalesKey));
    await Promise.all(tasks);
    setLastUpdatedAt(Date.now());
    setElapsedSec(0);
  }, [salesKey, prevSalesKey]);

  useEffect(() => {
    if (!lastUpdatedAt) return;
    const updateElapsed = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000)));
    };
    updateElapsed();
    const id = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(id);
  }, [lastUpdatedAt]);

  // 右パネルの「1人あたり売上」用に、日付範囲が決まっているときはドライバー・日報・ミッドナイトを取得（集計タブでなくても取得）
  useEffect(() => {
    if (!startIso || !endIso) return;
    if (tab === "summary") setLoadingSummary(true);
    apiFetch<{
      drivers: DriverRow[];
      reports: ReportRow[];
      midnights: MidnightRow[];
      summaryCourses?: SummaryCourseRow[];
      courseShifts?: Record<string, { driver_id: string; date: string }[]>;
    }>(`/api/admin/sales/reports?start=${startIso}&end=${endIso}${driverIdQuery}`)
      .then((res) => {
        setDrivers(res.drivers ?? []);
        setReports(res.reports ?? []);
        setMidnights(res.midnights ?? []);
        setSummaryCourses(res.summaryCourses ?? []);
        setCourseShifts(res.courseShifts ?? {});
      })
      .catch(() => {
        setDrivers([]);
        setReports([]);
        setMidnights([]);
        setSummaryCourses([]);
        setCourseShifts({});
      })
      .finally(() => {
        if (tab === "summary") setLoadingSummary(false);
      });
  }, [startIso, endIso, tab, driverIdQuery]);

  useEffect(() => {
    if (!startIso || !endIso) return;
    // 会社帰属ログの合計を全タブで使うため、日付範囲が決まったら常に取得する
    if (tab === "log") setLoadingLog(true);
    apiFetch<{ entries: SalesLogEntryRow[] }>(`/api/admin/sales/log?start=${startIso}&end=${endIso}`)
      .then((res) => setLogEntries(res.entries ?? []))
      .catch(() => setLogEntries([]))
      .finally(() => {
        if (tab === "log") setLoadingLog(false);
      });
  }, [tab, startIso, endIso]);

  useEffect(() => {
    if (tab !== "log") return;
    apiFetch<{ types: SalesLogTypeRow[] }>("/api/admin/sales/log/types")
      .then((res) => setLogTypes(res.types ?? []))
      .catch(() => setLogTypes([]));
  }, [tab]);

  useEffect(() => {
    if (!selectedDriverId) return;
    if (!(drivers ?? []).some((d) => d.id === selectedDriverId)) {
      setSelectedDriverId("");
    }
  }, [drivers, selectedDriverId]);
  useEffect(() => {
    if (tab !== "log") return;
    apiFetch<{ drivers: DriverRow[] }>("/api/admin/users")
      .then((res) => setLogDrivers(res.drivers ?? []))
      .catch(() => setLogDrivers([]));
  }, [tab]);
  useEffect(() => {
    if (tab !== "log") return;
    apiFetch<{ vehicles: VehicleRow[] }>("/api/admin/vehicles")
      .then((res) => setLogVehicles(res.vehicles ?? []))
      .catch(() => setLogVehicles([]));
  }, [tab]);

  useEffect(() => {
    if (tab !== "log") return;
    apiFetch<{ addresses: { id: string; name: string }[] }>("/api/admin/invoice-addresses")
      .then((res) =>
        setLogInvoiceAddresses((res.addresses ?? []).map((a) => ({ id: a.id, name: a.name })))
      )
      .catch(() => setLogInvoiceAddresses([]));
  }, [tab]);

  const invoiceAddressById = useMemo(() => {
    const m: Record<string, string> = {};
    logInvoiceAddresses.forEach((a) => {
      m[a.id] = a.name;
    });
    return m;
  }, [logInvoiceAddresses]);

  const logCompanyByDate = useMemo(() => {
    const rev = new Map<string, number>();
    const prof = new Map<string, number>();
    (logEntries ?? [])
      .filter((e) => e.attribution === "COMPANY")
      .forEach((e) => {
        const d = e.log_date;
        if (!d) return;
        rev.set(d, (rev.get(d) ?? 0) + (Number(e.revenue) || 0));
        prof.set(d, (prof.get(d) ?? 0) + (Number(e.profit) || 0));
      });
    return { rev, prof };
  }, [logEntries]);

  // 表示データは /api/admin/sales 側でドライバー条件込みで集計済み
  const displayData = useMemo(() => {
    return deliveryData;
  }, [deliveryData]);

  // 数値に応じた「きりの良い」上限（例: 15万→20万、23万→25万、38万→50万）
  const niceCeil = (value: number): number => {
    if (value <= 0) return 50000;
    const mag = 10 ** Math.floor(Math.log10(value));
    const n = value / mag;
    if (n <= 1) return mag * 1;
    if (n <= 2) return mag * 2;
    if (n <= 2.5) return mag * 2.5;
    if (n <= 5) return mag * 5;
    return mag * 10;
  };

  // グラフ縦軸用: 売上・利益の最大値に合わせた動的domain（きりの良い上限）
  const yAxisDomain = useMemo(() => {
    if (!displayData.length) return { left: [0, 100000] as [number, number], right: [0, 100000] as [number, number] };
    let maxRevenue = 0;
    let maxProfit = 0;
    for (const d of displayData) {
      const rev = d.yamato + d.amazon + (d.other ?? 0);
      if (rev > maxRevenue) maxRevenue = rev;
      if (d.profit > maxProfit) maxProfit = d.profit;
    }
    return {
      left: [0, niceCeil(Math.max(maxRevenue, 1))] as [number, number],
      right: [0, niceCeil(Math.max(maxProfit, 1))] as [number, number],
    };
  }, [displayData]);

  // 縦軸ラベル: 1万以上は「○万」、未満はそのまま（M表記は使わない）
  const yAxisTickFormatter = (v: number) =>
    v >= 10000 ? `${v / 10000}万` : v.toLocaleString("ja-JP");

  const daysInRange = useMemo(() => {
    if (!startIso || !endIso) return [];
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return [];
    }
    const list: { iso: string; label: string }[] = [];
    const d = new Date(start);
    while (d <= end) {
      const iso = toLocalYmd(d);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      list.push({ iso, label });
      d.setDate(d.getDate() + 1);
    }
    return list;
  }, [startIso, endIso]);

  const filteredDrivers = useMemo(
    () => (selectedDriverId ? (drivers ?? []).filter((d) => d.id === selectedDriverId) : drivers ?? []),
    [drivers, selectedDriverId],
  );
  const filteredReports = reports ?? [];
  const filteredMidnights = midnights ?? [];
  const filteredCourseShifts = courseShifts;

  const reportMap = useMemo(() => {
    const map = new Map<string, ReportRow>();
    (filteredReports ?? []).forEach((r) => map.set(`${r.driver_id}:${r.report_date}`, r));
    return map;
  }, [filteredReports]);

  const driverTotals = useMemo(() => {
    const totalsByDriver = new Map<string, { tk: number; nk: number; total: number }>();
    (filteredDrivers ?? []).forEach((d) => totalsByDriver.set(d.id, { tk: 0, nk: 0, total: 0 }));
    (filteredReports ?? []).forEach((r) => {
      const t = totalsByDriver.get(r.driver_id) ?? { tk: 0, nk: 0, total: 0 };
      const tk = r.takuhaibin_completed ?? 0;
      const nk = r.nekopos_completed ?? 0;
      t.tk += tk;
      t.nk += nk;
      t.total += tk + nk;
      totalsByDriver.set(r.driver_id, t);
    });
    return totalsByDriver;
  }, [filteredDrivers, filteredReports]);

  const midnightSet = useMemo(() => {
    const s = new Set<string>();
    (filteredMidnights ?? []).forEach((m) => {
      s.add(`${m.driver_id}:${m.date}`);
    });
    return s;
  }, [filteredMidnights]);

  const midnightCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (filteredMidnights ?? []).forEach((m) => {
      counts.set(m.driver_id, (counts.get(m.driver_id) ?? 0) + 1);
    });
    return counts;
  }, [filteredMidnights]);

  // 集計表示タイトル付きコースごとの (driver_id, date) セット
  const courseShiftSets = useMemo(() => {
    const map = new Map<string, Set<string>>();
    Object.entries(filteredCourseShifts).forEach(([courseId, list]) => {
      const s = new Set<string>();
      list.forEach(({ driver_id, date }) => s.add(`${driver_id}:${date}`));
      map.set(courseId, s);
    });
    return map;
  }, [filteredCourseShifts]);

  // 集計表示タイトル付きコースごとのドライバー別日数
  const courseShiftCounts = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    Object.entries(filteredCourseShifts).forEach(([courseId, list]) => {
      const byDriver = new Map<string, number>();
      list.forEach(({ driver_id }) => {
        byDriver.set(driver_id, (byDriver.get(driver_id) ?? 0) + 1);
      });
      map.set(courseId, byDriver);
    });
    return map;
  }, [filteredCourseShifts]);

  const totals = useMemo(() => {
    const yamato = displayData.reduce((s, d) => s + d.yamato, 0);
    const amazon = displayData.reduce((s, d) => s + d.amazon, 0);
    const profit = displayData.reduce((s, d) => s + d.profit, 0);
    const other = displayData.reduce((s, d) => s + (d.other ?? 0), 0);
    return { yamato, amazon, total: yamato + amazon + other, profit };
  }, [displayData]);

  // 会社帰属ログ（手動追加）の合計
  const logCompanyTotals = useMemo(() => {
    if (debouncedSelectedDriverId) return { revenue: 0, profit: 0 };
    let revenue = 0;
    let profit = 0;
    logCompanyByDate.rev.forEach((v) => { revenue += v; });
    logCompanyByDate.prof.forEach((v) => { profit += v; });
    return { revenue, profit };
  }, [logCompanyByDate, debouncedSelectedDriverId]);

  const displayTotals = useMemo(() => {
    // 全タブで「日報集計 + 会社帰属ログ」を同じ合計として扱う
    return totals;
  }, [totals]);

  const dailyAvg = useMemo(() => {
    const len = displayData.length || 1;
    return {
      revenue: Math.round(displayTotals.total / len),
      profit: Math.round(displayTotals.profit / len),
    };
  }, [displayTotals, displayData.length]);

  const daysCount = daysInRange.length || 1;
  const activeDays = useMemo(
    () => displayData.filter((d) => d.yamato + d.amazon > 0).length,
    [displayData],
  );
  const activeDriverCount = useMemo(() => {
    let count = 0;
    filteredDrivers.forEach((drv) => {
      const t = driverTotals.get(drv.id);
      const mid = midnightCounts.get(drv.id) ?? 0;
      if ((t && t.total > 0) || mid > 0) count += 1;
    });
    return count || 1;
  }, [filteredDrivers, driverTotals, midnightCounts]);

  const margin = displayTotals.total ? (displayTotals.profit / displayTotals.total) * 100 : null;
  const prevMargin =
    prevTotals && prevTotals.total
      ? (prevTotals.profit / prevTotals.total) * 100
      : null;

  const revenuePerDay = activeDays > 0 ? displayTotals.total / activeDays : 0;
  const revenuePerDriver = displayTotals.total / activeDriverCount;
  const utilization =
    daysCount > 0 ? ((activeDays / daysCount) * 100) : 0;

  const revenueChangePct =
    prevTotals && prevTotals.total
      ? ((displayTotals.total - prevTotals.total) / prevTotals.total) * 100
      : null;
  const marginDiff =
    margin != null && prevMargin != null ? margin - prevMargin : null;

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">売上</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              最終更新: {lastUpdatedAt ? `${elapsedSec}秒前` : "未取得"}
            </span>
            <button
              type="button"
              onClick={async () => {
                setManualRefreshing(true);
                try {
                  await refreshSalesCaches();
                } finally {
                  setManualRefreshing(false);
                }
              }}
              disabled={manualRefreshing || !startIso || !endIso}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FontAwesomeIcon icon={faRotateRight} className={manualRefreshing ? "animate-spin" : ""} />
              最新に更新
            </button>
          </div>
        </div>

        {/* Tabs */}
        <UnderlineTabs
          tabs={[
            { value: "analytics", label: "アナリティクス" },
            { value: "summary", label: "集計" },
            { value: "log", label: "ログ" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          className="mb-4"
        />

        {/* 日付範囲選択 + キャリア・コースフィルタ（アナリティクス / 集計 共通） */}
        <div className="flex flex-col gap-4 mb-6">
          <DateRangePicker value={range} onChange={setRange} hideSixMonths />
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs text-slate-500">対象コース</span>
            <CourseSelect
              courses={courses}
              value={selectedCourseIds}
              onChange={setSelectedCourseIds}
            />
            <span className="text-xs text-slate-500">対象ドライバー</span>
            <div className="w-56">
              <CustomSelect
                size="sm"
                value={selectedDriverId}
                onChange={setSelectedDriverId}
                options={[
                  { value: "", label: "すべてのドライバー" },
                  ...(drivers ?? []).map((d) => ({
                    value: d.id,
                    label: d.display_name ?? d.name,
                  })),
                ]}
                clearable={false}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row items-start gap-6">
          <div className="flex-1 min-w-0">
            {tab === "analytics" && (
              <>
                {loadingAnalytics ? (
                  <div className="bg-white rounded-lg border border-slate-200 p-6">
                    <Skeleton className="h-[420px] w-full" />
                  </div>
                ) : displayData.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8">該当データがありません</p>
                ) : (
                  <>
                    {/* チャート: 縦軸はデータに合わせて動的、縦方向は画面いっぱい */}
                    <div className="bg-white rounded-lg border border-slate-200 p-6 w-full" style={{ height: "clamp(420px, 65vh, 85vh)" }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={displayData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                          <YAxis yAxisId="left" domain={yAxisDomain.left} tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={yAxisTickFormatter} width={48} />
                          <YAxis yAxisId="right" domain={yAxisDomain.right} orientation="right" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={yAxisTickFormatter} width={48} />
                          <Tooltip content={<CustomTooltip />} />
                          <Legend wrapperStyle={{ paddingTop: "16px", fontSize: "12px" }} iconType="square" iconSize={10} />
                          <Bar yAxisId="left" dataKey="yamato" stackId="revenue" fill="#334155" name="ヤマト売上" radius={[0, 0, 0, 0]} />
                          <Bar yAxisId="left" dataKey="amazon" stackId="revenue" fill="#64748b" name="Amazon売上" />
                          <Bar yAxisId="left" dataKey="other" stackId="revenue" fill="#cbd5f5" name="その他売上" radius={[3, 3, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="profit" stroke="#059669" strokeWidth={2.5} name="利益" dot={{ fill: "#059669", r: 3, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
              </>
            )}

            {tab === "summary" && (
              <>
                <div className="text-sm text-slate-600 mb-3">
                  <span className="font-medium">daily_reports</span> の内容を月次で確認します（ヤマト個数: 宅急便/ネコポス）。
                </div>

                {loadingSummary ? (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="overflow-auto">
                      <table className="min-w-max text-xs w-full">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="px-3 py-2 text-left w-24"><Skeleton className="h-4 w-20" /></th>
                            <th className="px-2 py-2 w-8" />
                            {[...Array(14)].map((_, i) => (
                              <th key={i} className="px-2 py-2 min-w-[64px]"><Skeleton className="h-4 w-10 mx-auto" /></th>
                            ))}
                            <th className="px-3 py-2 text-right w-24"><Skeleton className="h-4 w-14 ml-auto" /></th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...Array(10)].map((_, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="px-3 py-2"><Skeleton className="h-4 w-16" /></td>
                              <td className="px-2 py-2 w-8" />
                              {[...Array(14)].map((_, j) => (
                                <td key={j} className="px-2 py-2"><Skeleton className="h-5 w-8 mx-auto" /></td>
                              ))}
                              <td className="px-3 py-2 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : filteredDrivers.length === 0 ? (
                  <p className="text-sm text-slate-500 py-8">ドライバーがいません</p>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="overflow-auto">
                      <table className="min-w-max text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="sticky left-0 z-20 bg-slate-50 border-b border-slate-200 px-3 py-2 text-left min-w-[100px]">
                              ドライバー
                            </th>
                            <th className="sticky left-[100px] z-10 bg-slate-50 border-b border-r border-slate-200 px-3 py-2 text-right min-w-[27px]"></th>
                            {daysInRange.map((d) => (
                              <th key={d.iso} className="border-b border-slate-200 px-2 py-2 text-center min-w-[64px]">
                                {d.label}
                              </th>
                            ))}
                            <th className="sticky right-0 z-20 bg-slate-50 border-b border-l border-slate-200 px-3 py-2 text-right min-w-[96px]">
                              <div className="text-right">
                                <div>月計</div>
                                <div className="text-[10px] text-slate-400">ミッド</div>
                              </div>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredDrivers.map((drv) => {
                            const t = driverTotals.get(drv.id) ?? { tk: 0, nk: 0, total: 0 };
                            const midDays = midnightCounts.get(drv.id) ?? 0;
                            return (
                              <Fragment key={drv.id}>
                                <tr className="border-t border-slate-100">
                                  <td className="sticky left-0 z-10 bg-white border-r border-slate-100 px-3 py-2 text-left">
                                    <div className="font-medium text-slate-900">{drv.display_name ?? drv.name}</div>
                                  </td>
                                  <td className="sticky left-[100px] z-10 bg-white border-r border-slate-100 px-3 py-2 text-right">
                                    <div className="text-[10px] text-slate-400">宅</div>
                                    <div className="text-[10px] text-slate-400">ネ</div>
                                  </td>
                                  {daysInRange.map((d) => {
                                    const key = `${drv.id}:${d.iso}`;
                                    const isMidnight = midnightSet.has(key);
                                    const r = reportMap.get(key);
                                    const tk = r?.takuhaibin_completed ?? 0;
                                    const nk = r?.nekopos_completed ?? 0;
                                    const tkRet = r?.takuhaibin_returned ?? 0;
                                    const nkRet = r?.nekopos_returned ?? 0;
                                    const has = tk + nk > 0 || isMidnight;
                                    return (
                                      <td
                                        key={d.iso}
                                        className={`px-2 py-2 text-center ${has ? "text-slate-900" : "text-slate-300"}`}
                                        title={
                                          isMidnight
                                            ? "Amazonミッドナイト"
                                            : `宅急便 配完 ${tk} / 持戻 ${tkRet}\nネコポス 配完 ${nk} / 持戻 ${nkRet}`
                                        }
                                      >
                                        {isMidnight ? (
                                          <div className="text-[11px] font-semibold text-indigo-600">ミッド</div>
                                        ) : (
                                          <>
                                            <div className="tabular-nums text-[11px] font-semibold">{tk || "·"}</div>
                                            <div className="tabular-nums text-[11px] font-semibold">{nk || "·"}</div>
                                          </>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="sticky right-0 z-10 bg-white border-l border-slate-100 px-3 py-2 text-right">
                                    <div className="flex items-center justify-end gap-3">
                                      <div className="text-right">
                                        <div className="tabular-nums font-semibold text-slate-900">
                                          {t.tk}
                                        </div>
                                        <div className="tabular-nums font-semibold text-slate-900 mt-0.5">
                                          {t.nk}
                                        </div>
                                      </div>
                                      <div className="w-10 text-[10px] font-semibold text-slate-900 whitespace-nowrap">
                                        {midDays}日
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                                {summaryCourses.length > 0 &&
                                  summaryCourses.map((sc) => {
                                    const shiftSet = courseShiftSets.get(sc.id) ?? new Set<string>();
                                    const shiftCountByDriver = courseShiftCounts.get(sc.id) ?? new Map<string, number>();
                                    const days = shiftCountByDriver.get(drv.id) ?? 0;
                                    const hasAny = days > 0;
                                    return (
                                      <tr
                                        key={`${drv.id}-${sc.id}`}
                                        className="border-t border-slate-50 bg-slate-50/40"
                                      >
                                        <td className="sticky left-0 z-10 bg-white border-r border-slate-100 px-3 py-1.5 text-left">
                                          <div className="text-[11px] text-slate-700">
                                            <span className="mr-1 text-slate-500">↳</span>
                                            {sc.summary_title}
                                          </div>
                                        </td>
                                        <td className="sticky left-[100px] z-10 bg-white border-r border-slate-100 px-3 py-1.5 text-right">
                                          <div className="text-[10px] text-slate-400">シフト</div>
                                        </td>
                                        {daysInRange.map((d) => {
                                          const key = `${drv.id}:${d.iso}`;
                                          const hasShift = shiftSet.has(key);
                                          return (
                                            <td
                                              key={d.iso}
                                              className={`px-2 py-1.5 text-center ${hasShift ? "text-slate-900" : "text-slate-300"}`}
                                            >
                                              {hasShift ? (
                                                <div className="text-[11px] font-semibold text-indigo-600">〇</div>
                                              ) : (
                                                <span className="text-slate-300">·</span>
                                              )}
                                            </td>
                                          );
                                        })}
                                        <td className="sticky right-0 z-10 bg-white border-l border-slate-100 px-3 py-1.5 text-right">
                                          <div className="tabular-nums text-[11px] font-semibold text-slate-900">
                                            {hasAny ? `${days}日` : "0日"}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {tab === "log" && (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => {
                        setLogEditingEntry(null);
                        setLogModalOpen(true);
                      }}
                      className="shrink-0 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
                    >
                      新規追加
                    </button>
                  )}
                </div>
                <LogEntryModal
                  open={logModalOpen}
                  onClose={() => {
                    setLogModalOpen(false);
                    setLogEditingEntry(null);
                  }}
                  startIso={startIso}
                  editingEntry={logEditingEntry}
                  logTypes={logTypes}
                  drivers={logDrivers}
                  vehicles={logVehicles}
                  invoiceAddresses={logInvoiceAddresses}
                  onSaved={() => {
                    if (startIso && endIso) {
                      apiFetch<{ entries: SalesLogEntryRow[] }>(`/api/admin/sales/log?start=${startIso}&end=${endIso}`)
                        .then((res) => setLogEntries(res.entries ?? []))
                        .catch(() => { });
                    }
                    void refreshSalesCaches();
                  }}
                  onTypeAdded={() => {
                    apiFetch<{ types: SalesLogTypeRow[] }>("/api/admin/sales/log/types")
                      .then((res) => setLogTypes(res.types ?? []))
                      .catch(() => { });
                  }}
                />
                {loadingLog ? (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden p-6 mt-4">
                    <Skeleton className="h-8 w-full mb-4" />
                    <Skeleton className="h-64 w-full" />
                  </div>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mt-4">
                    <LogEntriesByDate
                      entries={logEntries}
                      displayData={displayData}
                      daysInRange={daysInRange}
                      canWrite={canWrite}
                      logTypes={logTypes}
                      drivers={logDrivers}
                      vehicles={logVehicles}
                      invoiceAddressById={invoiceAddressById}
                      startIso={startIso}
                      endIso={endIso}
                      onUpdated={() => {
                        if (startIso && endIso) {
                          apiFetch<{ entries: SalesLogEntryRow[] }>(`/api/admin/sales/log?start=${startIso}&end=${endIso}`)
                            .then((res) => setLogEntries(res.entries ?? []))
                            .catch(() => { });
                        }
                        void refreshSalesCaches();
                      }}
                      onEdit={(entry) => {
                        setLogEditingEntry(entry);
                        setLogModalOpen(true);
                      }}
                      onRequestDelete={(entry) => setLogDeleteTarget(entry)}
                      savingId={logSavingId}
                      setSavingId={setLogSavingId}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* 右パネル: 分析サマリー */}
          <div className="w-full lg:w-80 space-y-4">
            {loadingAnalytics ? (
              <>
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <Skeleton className="h-3 w-14 mb-2" />
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <Skeleton className="h-4 flex-1 max-w-[100px]" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <Skeleton className="h-3 w-12 mb-2" />
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <Skeleton className="h-4 flex-1 max-w-[120px]" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <Skeleton className="h-3 w-16 mb-2" />
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="flex justify-between gap-2">
                        <Skeleton className="h-4 flex-1 max-w-[100px]" />
                        <Skeleton className="h-4 w-16" />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* 1日の売上（選択日） */}
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-500 mb-1">1日の売上</div>
                      {(() => {
                        const day = selectedDayIso;
                        const point = day ? displayData.find((d) => d.iso === day) : undefined;
                        const dayRevenue = point ? (point.yamato + point.amazon + (point.other ?? 0)) : 0;
                        const dayProfit = point ? (point.profit ?? 0) : 0;
                        return (
                          <>
                            <div className="text-xl font-bold text-slate-900 tracking-tight">{fmt(dayRevenue)}</div>
                            <div className="text-xs text-slate-500 mt-1">
                              利益{" "}
                              <span className={dayProfit >= 0 ? "text-emerald-600 font-semibold tabular-nums" : "text-red-600 font-semibold tabular-nums"}>
                                {fmtSigned(dayProfit)}
                              </span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <div className="w-[150px]">
                      <DatePicker
                        value={selectedDayIso ? new Date(selectedDayIso + "T12:00:00") : undefined}
                        onChange={(d) => setSelectedDayIso(d ? toLocalYmd(d) : "")}
                        placeholder="日付"
                        className="h-10 w-full"
                      />
                    </div>
                  </div>
                  {startIso && endIso && selectedDayIso && (selectedDayIso < startIso || selectedDayIso > endIso) && (
                    <p className="mt-2 text-[11px] text-amber-700">
                      選択日が期間外です（現在の期間: {startIso}〜{endIso}）
                    </p>
                  )}
                </div>

                {/* 売上カード: 売上を大きく、前期間比は近くに小さく */}
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <div className="text-xs font-semibold text-slate-500 mb-1">売上</div>
                  <div className="text-2xl font-bold text-slate-900 tracking-tight">{fmt(displayTotals.total)}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    {loadingPrev && <span>前期間計算中...</span>}
                    {!loadingPrev && revenueChangePct != null && (
                      <>
                        <FontAwesomeIcon icon={revenueChangePct >= 0 ? faArrowTrendUp : faArrowTrendDown} className={revenueChangePct >= 0 ? "text-emerald-600" : "text-red-600"} />
                        <span className={revenueChangePct >= 0 ? "text-emerald-600" : "text-red-600"}>
                          {revenueChangePct >= 0 ? "+" : ""}{revenueChangePct.toFixed(1)}%
                        </span>
                        <span className="text-slate-500">前期間比</span>
                      </>
                    )}
                    {!loadingPrev && revenueChangePct == null && <span>– 前期間比</span>}
                  </div>
                </div>

                {/* 粗利カード: 粗利率は粗利の後ろにカッコ書き */}
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <div className="text-xs font-semibold text-slate-500 mb-1">粗利</div>
                  <div className="text-2xl font-bold text-slate-900 tracking-tight">
                    {fmt(displayTotals.profit)}
                    {margin != null && <span className="text-lg font-semibold text-slate-600"> ({margin.toFixed(1)}%)</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    {marginDiff != null && (
                      <>
                        <FontAwesomeIcon icon={marginDiff >= 0 ? faArrowTrendUp : faArrowTrendDown} className={marginDiff >= 0 ? "text-emerald-600" : "text-red-600"} />
                        <span className={marginDiff >= 0 ? "text-emerald-600" : "text-red-600"}>
                          {marginDiff >= 0 ? "+" : ""}{marginDiff.toFixed(2)}pt
                        </span>
                        <span className="text-slate-500">粗利率変化</span>
                      </>
                    )}
                    {marginDiff == null && <span>– 粗利率変化</span>}
                  </div>
                </div>

                {/* その他指標: 1日平均・1人あたり・稼働率 */}
                <div className="bg-white rounded-lg border border-slate-200 p-4">
                  <div className="space-y-3 text-sm">
                    <div>
                      <div className="text-xs font-semibold text-slate-500 mb-0.5">1日平均売上</div>
                      <div className="font-semibold text-slate-900">{fmt(Math.round(revenuePerDay))}</div>
                    </div>
                    <hr className="border-slate-100" />
                    <div>
                      <div className="text-xs font-semibold text-slate-500 mb-0.5">1人あたり売上</div>
                      <div className="font-semibold text-slate-900">{fmt(Math.round(revenuePerDriver))}</div>
                    </div>
                    <hr className="border-slate-100" />
                    <div>
                      <div className="text-xs font-semibold text-slate-500 mb-0.5">稼働率</div>
                      <div className="font-semibold text-slate-900">
                        {daysCount > 0 ? `${utilization.toFixed(1)}%` : "–"}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!logDeleteTarget}
        message="このログを削除しますか？"
        confirmLabel="削除"
        onClose={() => setLogDeleteTarget(null)}
        onConfirm={() => {
          const target = logDeleteTarget;
          if (!target) return;
          setLogDeleteTarget(null);
          setLogSavingId(target.id);
          apiFetch(`/api/admin/sales/log/${target.id}`, { method: "DELETE" })
            .then(() => {
              if (startIso && endIso) {
                return apiFetch<{ entries: SalesLogEntryRow[] }>(`/api/admin/sales/log?start=${startIso}&end=${endIso}`)
                  .then((res) => setLogEntries(res.entries ?? []))
                  .catch(() => { });
              }
            })
            .then(() => {
              void refreshSalesCaches();
            })
            .catch(() => { })
            .finally(() => setLogSavingId(null));
        }}
      />
    </AdminLayout>
  );
}
