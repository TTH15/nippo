"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowTrendUp, faArrowTrendDown, faPenToSquare } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";
import { DateRangePicker, type DateRangeValue } from "@/lib/components/DateRangePicker";
import { DatePicker } from "@/lib/components/DatePicker";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { UnderlineTabs } from "@/lib/components/UnderlineTabs";
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

type DataPoint = { date: string; yamato: number; amazon: number; profit: number };
type DriverRow = { id: string; name: string; display_name?: string | null };
type CourseRow = { id: string; name: string; carrier?: "YAMATO" | "AMAZON" | "OTHER" | null };
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
  amount: number;
  attribution: "COMPANY" | "DRIVER";
  target_driver_id: string | null;
  target_driver_name: string | null;
  vehicle_id: string | null;
  vehicle_label: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
};
type VehicleRow = { id: string; manufacturer?: string | null; brand?: string | null; number_numeric?: string | null };

const fmt = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const fmtAmount = (amount: number) => {
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
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-4 py-3 text-sm">
      <p className="font-medium text-slate-900 mb-1.5">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span
            className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-slate-600">{entry.name}</span>
          <span className="ml-auto font-medium text-slate-900 pl-4">
            {fmt(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

function LogEntryModal({
  open,
  onClose,
  startIso,
  logTypes,
  drivers,
  vehicles,
  onAdded,
  onTypeAdded,
}: {
  open: boolean;
  onClose: () => void;
  startIso: string;
  logTypes: SalesLogTypeRow[];
  drivers: DriverRow[];
  vehicles: VehicleRow[];
  onAdded: () => void;
  onTypeAdded: () => void;
}) {
  const [logDate, setLogDate] = useState("");
  const [typeId, setTypeId] = useState("");
  const [content, setContent] = useState("");
  const [amountSign, setAmountSign] = useState<"+" | "-">("+");
  const [amountValue, setAmountValue] = useState<string>("");
  const [attribution, setAttribution] = useState<"COMPANY" | "DRIVER">("COMPANY");
  const [targetDriverId, setTargetDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [addingType, setAddingType] = useState(false);

  useEffect(() => {
    if (open) {
      setLogDate(startIso || "");
      setTypeId("");
      setContent("");
      setAmountSign("+");
      setAmountValue("");
      setAttribution("COMPANY");
      setTargetDriverId("");
      setVehicleId("");
      setMemo("");
    }
  }, [open, startIso]);

  const vehicleLabel = (v: VehicleRow) => [v.manufacturer, v.brand, v.number_numeric].filter(Boolean).join(" ") || v.id;
  const dateValue = logDate ? new Date(logDate + "T12:00:00") : undefined;

  const handleAdd = () => {
    if (!logDate || !typeId || content.trim() === "") return;
    const absVal = Math.abs(Number(amountValue) || 0);
    const amount = amountSign === "-" ? -absVal : absVal;
    setSubmitting(true);
    apiFetch("/api/admin/sales/log", {
      method: "POST",
      body: JSON.stringify({
        log_date: logDate,
        type_id: typeId,
        content: content.trim(),
        amount,
        attribution,
        target_driver_id: targetDriverId || null,
        vehicle_id: vehicleId || null,
        memo: memo.trim() || null,
      }),
    })
      .then(() => {
        onAdded();
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
          <h2 className="text-base font-semibold text-slate-900">ログを追加</h2>
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
              <div className="flex gap-2 items-stretch min-w-0">
                <div className="flex-1 min-w-0">
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
                  className={`w-24 min-w-0 shrink-0 rounded-xl ${inputClass}`}
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
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">金額</label>
              <div className="flex gap-2 items-stretch">
                <div className="flex rounded-xl overflow-hidden border-2 border-slate-200 h-12 shrink-0">
                  <button
                    type="button"
                    onClick={() => setAmountSign("+")}
                    className={`px-4 font-medium text-sm transition-colors ${amountSign === "+" ? "bg-green-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => setAmountSign("-")}
                    className={`px-4 font-medium text-sm transition-colors ${amountSign === "-" ? "bg-red-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    −
                  </button>
                </div>
                <input
                  type="number"
                  value={amountValue}
                  onChange={(e) => setAmountValue(e.target.value)}
                  placeholder="0"
                  className={`flex-1 min-w-0 text-right tabular-nums ${inputClass}`}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">帰属先</label>
              <CustomSelect
                size="md"
                options={[
                  { value: "COMPANY", label: "会社" },
                  { value: "DRIVER", label: "ドライバー" },
                ]}
                value={attribution}
                onChange={(v) => setAttribution(v as "COMPANY" | "DRIVER")}
                clearable={false}
              />
            </div>
            <div className="sm:col-span-2 grid grid-cols-2 gap-4">
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
            onClick={handleAdd}
            disabled={submitting || !logDate || !typeId || content.trim() === ""}
            className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? "追加中..." : "登録"}
          </button>
        </div>
      </div>
    </div>
  );
}

type LogRow =
  | { kind: "calculated"; type_name: string; content: string; amount: number }
  | { kind: "entry"; entry: SalesLogEntryRow };

function LogEntriesByDate({
  entries,
  displayData,
  daysInRange,
  canWrite,
  logTypes,
  drivers,
  vehicles,
  startIso,
  endIso,
  onUpdated,
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
  startIso: string;
  endIso: string;
  onUpdated: () => void;
  savingId: string | null;
  setSavingId: (id: string | null) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SalesLogEntryRow>>({});

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
  const [filterAttribution, setFilterAttribution] = useState("");
  const [sortDateOrder, setSortDateOrder] = useState<"desc" | "asc">("desc");

  const byDate = useMemo((): [string, LogRow[]][] => {
    const out: [string, LogRow[]][] = [];
    daysInRange.forEach((day, i) => {
      const sales = displayData[i];
      const yamato = sales?.yamato ?? 0;
      const amazon = sales?.amazon ?? 0;
      const dayEntries = entriesByDate.get(day.iso) ?? [];
      const rows: LogRow[] = [];
      if (yamato > 0) rows.push({ kind: "calculated", type_name: "売上", content: "ヤマト宅急便等", amount: yamato });
      if (amazon > 0) rows.push({ kind: "calculated", type_name: "売上", content: "Amazon等", amount: amazon });
      dayEntries.forEach((e) => rows.push({ kind: "entry", entry: e }));
      let filtered = rows;
      if (filterTypeId) filtered = filtered.filter((r) => r.kind === "calculated" || r.entry.type_id === filterTypeId);
      if (filterAttribution) filtered = filtered.filter((r) => r.kind === "calculated" ? filterAttribution === "COMPANY" : r.entry.attribution === filterAttribution);
      if (filtered.length > 0) out.push([day.iso, filtered]);
    });
    return out.sort((a, b) => (sortDateOrder === "desc" ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])));
  }, [daysInRange, displayData, entriesByDate, filterTypeId, filterAttribution, sortDateOrder]);

  const dateLabel = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${m}月${d}日`;
  };

  const handleDelete = (id: string) => {
    if (!canWrite || !confirm("この行を削除しますか？")) return;
    setSavingId(id);
    apiFetch(`/api/admin/sales/log/${id}`, { method: "DELETE" })
      .then(() => onUpdated())
      .catch(() => { })
      .finally(() => setSavingId(null));
  };

  const startEdit = (row: SalesLogEntryRow) => {
    setEditingId(row.id);
    setEditForm({
      type_id: row.type_id,
      content: row.content,
      amount: row.amount,
      attribution: row.attribution,
      target_driver_id: row.target_driver_id,
      vehicle_id: row.vehicle_id,
      memo: row.memo ?? "",
    });
  };

  const saveEdit = () => {
    if (!editingId || !canWrite) return;
    setSavingId(editingId);
    apiFetch(`/api/admin/sales/log/${editingId}`, {
      method: "PATCH",
      body: JSON.stringify({
        type_id: editForm.type_id,
        content: editForm.content,
        amount: editForm.amount,
        attribution: editForm.attribution,
        target_driver_id: editForm.target_driver_id || null,
        vehicle_id: editForm.vehicle_id || null,
        memo: editForm.memo?.trim() || null,
      }),
    })
      .then(() => {
        setEditingId(null);
        onUpdated();
      })
      .catch(() => { })
      .finally(() => setSavingId(null));
  };

  if (byDate.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        この期間にログがありません。右上の「新規追加」から登録するか、日付範囲を変更してください。
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">種別</span>
          <select
            value={filterTypeId}
            onChange={(e) => setFilterTypeId(e.target.value)}
            className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white min-w-[100px]"
          >
            <option value="">すべて</option>
            {logTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">帰属先</span>
          <select
            value={filterAttribution}
            onChange={(e) => setFilterAttribution(e.target.value)}
            className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white min-w-[90px]"
          >
            <option value="">すべて</option>
            <option value="COMPANY">会社</option>
            <option value="DRIVER">ドライバー</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">並べ替え</span>
          <select
            value={sortDateOrder}
            onChange={(e) => setSortDateOrder(e.target.value as "desc" | "asc")}
            className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white min-w-[110px]"
          >
            <option value="desc">日付 新→古</option>
            <option value="asc">日付 古→新</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        {byDate.map(([dateIso, rows]) => (
          <div key={dateIso} className="border-b border-slate-100 last:border-b-0">
            <div className="px-3 py-2 bg-slate-50 font-semibold text-slate-800 text-sm">
              {dateLabel(dateIso)}
            </div>
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-20">種別</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 min-w-[140px]">内容</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 w-24">金額</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-16">帰属先</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-24">対象者</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-28">車両</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 min-w-[80px]">備考</th>
                  {canWrite && <th className="px-3 py-2 w-20" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIdx) => {
                  if (row.kind === "calculated") {
                    return (
                      <tr key={`calc-${dateIso}-${rowIdx}`} className="border-t border-slate-100 bg-slate-50/30">
                        <td className="px-3 py-2 font-medium text-slate-800">{row.type_name}</td>
                        <td className="px-3 py-2 text-slate-600">{row.content}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-600">{fmtAmount(row.amount)}</td>
                        <td className="px-3 py-2 text-slate-500">会社</td>
                        <td className="px-3 py-2 text-slate-500">—</td>
                        <td className="px-3 py-2 text-slate-500">—</td>
                        <td className="px-3 py-2 text-slate-400 text-[11px]">—</td>
                        {canWrite && <td className="px-3 py-2" />}
                      </tr>
                    );
                  }
                  const r = row.entry;
                  const isEditing = editingId === r.id;
                  const saving = savingId === r.id;
                  return (
                    <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                      {isEditing ? (
                        <>
                          <td className="px-3 py-2">
                            <CustomSelect
                              size="sm"
                              options={logTypes.map((t) => ({ value: t.id, label: t.name }))}
                              value={editForm.type_id ?? ""}
                              onChange={(v) => setEditForm((f) => ({ ...f, type_id: v }))}
                              placeholder="選択"
                              clearable
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={editForm.content ?? ""}
                              onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                              className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              value={editForm.amount ?? 0}
                              onChange={(e) => setEditForm((f) => ({ ...f, amount: Number(e.target.value) || 0 }))}
                              className="w-full px-2 py-1 border border-slate-200 rounded text-xs text-right tabular-nums"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <CustomSelect
                              size="sm"
                              options={[
                                { value: "COMPANY", label: "会社" },
                                { value: "DRIVER", label: "ドライバー" },
                              ]}
                              value={editForm.attribution ?? "COMPANY"}
                              onChange={(v) => setEditForm((f) => ({ ...f, attribution: v as "COMPANY" | "DRIVER" }))}
                              clearable={false}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <CustomSelect
                              size="sm"
                              options={[{ value: "", label: "—" }, ...drivers.map((d) => ({ value: d.id, label: d.display_name ?? d.name }))]}
                              value={editForm.target_driver_id ?? ""}
                              onChange={(v) => setEditForm((f) => ({ ...f, target_driver_id: v || null }))}
                              placeholder="—"
                              clearable
                            />
                          </td>
                          <td className="px-3 py-2">
                            <CustomSelect
                              size="sm"
                              options={[{ value: "", label: "—" }, ...vehicles.map((v) => ({ value: v.id, label: vehicleLabel(v) }))]}
                              value={editForm.vehicle_id ?? ""}
                              onChange={(v) => setEditForm((f) => ({ ...f, vehicle_id: v || null }))}
                              placeholder="—"
                              clearable
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={editForm.memo ?? ""}
                              onChange={(e) => setEditForm((f) => ({ ...f, memo: e.target.value }))}
                              className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                            />
                          </td>
                          {canWrite && (
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <button type="button" onClick={saveEdit} className="px-2 py-1 bg-slate-700 text-white rounded text-[10px]">保存</button>
                                <button type="button" onClick={() => setEditingId(null)} className="px-2 py-1 bg-slate-200 rounded text-[10px]">取消</button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!editingId) return;
                                    if (!confirm("この行を削除しますか？")) return;
                                    setSavingId(editingId);
                                    apiFetch(`/api/admin/sales/log/${editingId}`, { method: "DELETE" })
                                      .then(() => { setEditingId(null); onUpdated(); })
                                      .catch(() => { })
                                      .finally(() => setSavingId(null));
                                  }}
                                  className="px-2 py-1 bg-red-100 text-red-700 rounded text-[10px] hover:bg-red-200"
                                >
                                  削除
                                </button>
                              </div>
                            </td>
                          )}
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 font-medium text-slate-800">{r.type_name}</td>
                          <td className="px-3 py-2 text-slate-700">{r.content}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.amount >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {fmtAmount(r.amount)}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{r.attribution === "COMPANY" ? "会社" : "ドライバー"}</td>
                          <td className="px-3 py-2 text-slate-600">{r.target_driver_name ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-600">{r.vehicle_label ?? "—"}</td>
                          <td className="px-3 py-2 text-slate-500 text-[11px]">{r.memo ?? "—"}</td>
                          {canWrite && (
                            <td className="px-3 py-2">
                              {saving ? (
                                <span className="text-slate-400 text-[10px]">保存中...</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startEdit(r)}
                                  title="編集"
                                  className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
                                >
                                  <FontAwesomeIcon icon={faPenToSquare} className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SalesPage() {
  const [tab, setTab] = useState<Tab>("analytics");
  const [range, setRange] = useState<DateRangeValue | undefined>();
  const [deliveryData, setDeliveryData] = useState<DataPoint[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [midnights, setMidnights] = useState<MidnightRow[]>([]);
  const [prevTotals, setPrevTotals] = useState<{ total: number; profit: number } | null>(null);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());
  const [logEntries, setLogEntries] = useState<SalesLogEntryRow[]>([]);
  const [logTypes, setLogTypes] = useState<SalesLogTypeRow[]>([]);
  const [logDrivers, setLogDrivers] = useState<DriverRow[]>([]);
  const [logVehicles, setLogVehicles] = useState<VehicleRow[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [logSavingId, setLogSavingId] = useState<string | null>(null);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
  }, []);

  // コース一覧を取得
  useEffect(() => {
    apiFetch<{ courses: CourseRow[] }>("/api/admin/courses")
      .then((res) => setCourses(res.courses ?? []))
      .catch(() => setCourses([]));
  }, []);

  const courseIdsQuery =
    selectedCourseIds.size > 0
      ? `&course_ids=${Array.from(selectedCourseIds).join(",")}`
      : "";

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

  // 前期間（同じ日数分ひとつ前の区間）の売上・利益を取得
  useEffect(() => {
    if (!startIso || !endIso) return;
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return;
    }
    const days =
      Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      ) || 1;

    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (days - 1));

    const prevStartIso = toLocalYmd(prevStart);
    const prevEndIso = toLocalYmd(prevEnd);

    setLoadingPrev(true);
    apiFetch<{ data: DataPoint[] }>(
      `/api/admin/sales?start=${prevStartIso}&end=${prevEndIso}${courseIdsQuery}`,
    )
      .then((res) => {
        const data = res.data ?? [];
        const yamato = data.reduce((s, d) => s + d.yamato, 0);
        const amazon = data.reduce((s, d) => s + d.amazon, 0);
        const profit = data.reduce((s, d) => s + d.profit, 0);
        setPrevTotals({ total: yamato + amazon, profit });
      })
      .catch(() => setPrevTotals(null))
      .finally(() => setLoadingPrev(false));
  }, [startIso, endIso, courseIdsQuery]);

  useEffect(() => {
    if (!startIso || !endIso) return;
    setLoadingAnalytics(true);
    apiFetch<{ data: DataPoint[] }>(
      `/api/admin/sales?start=${startIso}&end=${endIso}${courseIdsQuery}`,
    )
      .then((res) => setDeliveryData(res.data ?? []))
      .catch(() => setDeliveryData([]))
      .finally(() => setLoadingAnalytics(false));
  }, [startIso, endIso, courseIdsQuery]);

  useEffect(() => {
    if (tab !== "summary" || !startIso || !endIso) return;
    setLoadingSummary(true);
    apiFetch<{
      drivers: DriverRow[];
      reports: ReportRow[];
      midnights: MidnightRow[];
    }>(`/api/admin/sales/reports?start=${startIso}&end=${endIso}`)
      .then((res) => {
        setDrivers(res.drivers ?? []);
        setReports(res.reports ?? []);
        setMidnights(res.midnights ?? []);
      })
      .catch(() => {
        setDrivers([]);
        setReports([]);
        setMidnights([]);
      })
      .finally(() => setLoadingSummary(false));
  }, [startIso, endIso, tab]);

  useEffect(() => {
    if (tab !== "log" || !startIso || !endIso) return;
    setLoadingLog(true);
    apiFetch<{ entries: SalesLogEntryRow[] }>(`/api/admin/sales/log?start=${startIso}&end=${endIso}`)
      .then((res) => setLogEntries(res.entries ?? []))
      .catch(() => setLogEntries([]))
      .finally(() => setLoadingLog(false));
  }, [tab, startIso, endIso]);

  useEffect(() => {
    if (tab !== "log") return;
    apiFetch<{ types: SalesLogTypeRow[] }>("/api/admin/sales/log/types")
      .then((res) => setLogTypes(res.types ?? []))
      .catch(() => setLogTypes([]));
  }, [tab]);
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

  const displayData = deliveryData;

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
      const rev = d.yamato + d.amazon;
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

  const reportMap = useMemo(() => {
    const map = new Map<string, ReportRow>();
    (reports ?? []).forEach((r) => map.set(`${r.driver_id}:${r.report_date}`, r));
    return map;
  }, [reports]);

  const driverTotals = useMemo(() => {
    const totalsByDriver = new Map<string, { tk: number; nk: number; total: number }>();
    (drivers ?? []).forEach((d) => totalsByDriver.set(d.id, { tk: 0, nk: 0, total: 0 }));
    (reports ?? []).forEach((r) => {
      const t = totalsByDriver.get(r.driver_id) ?? { tk: 0, nk: 0, total: 0 };
      const tk = r.takuhaibin_completed ?? 0;
      const nk = r.nekopos_completed ?? 0;
      t.tk += tk;
      t.nk += nk;
      t.total += tk + nk;
      totalsByDriver.set(r.driver_id, t);
    });
    return totalsByDriver;
  }, [drivers, reports]);

  const midnightSet = useMemo(() => {
    const s = new Set<string>();
    (midnights ?? []).forEach((m) => {
      s.add(`${m.driver_id}:${m.date}`);
    });
    return s;
  }, [midnights]);

  const midnightCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (midnights ?? []).forEach((m) => {
      counts.set(m.driver_id, (counts.get(m.driver_id) ?? 0) + 1);
    });
    return counts;
  }, [midnights]);

  const totals = useMemo(() => {
    const yamato = displayData.reduce((s, d) => s + d.yamato, 0);
    const amazon = displayData.reduce((s, d) => s + d.amazon, 0);
    const profit = displayData.reduce((s, d) => s + d.profit, 0);
    return { yamato, amazon, total: yamato + amazon, profit };
  }, [displayData]);

  // ログタブ時: 帰属先=会社のログを売上・粗利に加算（プラスは売上+利益、マイナスは委託費で粗利を確定）
  const logCompanyTotals = useMemo(() => {
    const revenue = logEntries
      .filter((e) => e.attribution === "COMPANY" && e.amount > 0)
      .reduce((s, e) => s + e.amount, 0);
    const profit = logEntries
      .filter((e) => e.attribution === "COMPANY")
      .reduce((s, e) => s + e.amount, 0);
    return { revenue, profit };
  }, [logEntries]);

  const displayTotals = useMemo(() => {
    if (tab !== "log") return totals;
    return {
      ...totals,
      total: totals.total + logCompanyTotals.revenue,
      profit: totals.profit + logCompanyTotals.profit,
    };
  }, [tab, totals, logCompanyTotals]);

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
    drivers.forEach((drv) => {
      const t = driverTotals.get(drv.id);
      const mid = midnightCounts.get(drv.id) ?? 0;
      if ((t && t.total > 0) || mid > 0) count += 1;
    });
    return count || 1;
  }, [drivers, driverTotals, midnightCounts]);

  const margin = displayTotals.total ? (displayTotals.profit / displayTotals.total) * 100 : null;
  const prevMargin =
    prevTotals && prevTotals.total
      ? (prevTotals.profit / prevTotals.total) * 100
      : null;

  const revenuePerDay = displayTotals.total / daysCount;
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
          <DateRangePicker value={range} onChange={setRange} />
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs text-slate-500">対象コース</span>
            <CourseSelect
              courses={courses}
              value={selectedCourseIds}
              onChange={setSelectedCourseIds}
            />
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
                          <Bar yAxisId="left" dataKey="amazon" stackId="revenue" fill="#94a3b8" name="Amazon売上" radius={[3, 3, 0, 0]} />
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
                ) : drivers.length === 0 ? (
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
                          {drivers.map((drv) => {
                            const t = driverTotals.get(drv.id) ?? { tk: 0, nk: 0, total: 0 };
                            const midDays = midnightCounts.get(drv.id) ?? 0;
                            return (
                              <tr key={drv.id} className="border-t border-slate-100">
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
                      onClick={() => setLogModalOpen(true)}
                      className="shrink-0 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
                    >
                      新規追加
                    </button>
                  )}
                </div>
                <LogEntryModal
                  open={logModalOpen}
                  onClose={() => setLogModalOpen(false)}
                  startIso={startIso}
                  logTypes={logTypes}
                  drivers={logDrivers}
                  vehicles={logVehicles}
                  onAdded={() => {
                    if (startIso && endIso) {
                      apiFetch<{ entries: SalesLogEntryRow[] }>(`/api/admin/sales/log?start=${startIso}&end=${endIso}`)
                        .then((res) => setLogEntries(res.entries ?? []))
                        .catch(() => { });
                    }
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
                      startIso={startIso}
                      endIso={endIso}
                      onUpdated={() => {
                        if (startIso && endIso) {
                          apiFetch<{ entries: SalesLogEntryRow[] }>(`/api/admin/sales/log?start=${startIso}&end=${endIso}`)
                            .then((res) => setLogEntries(res.entries ?? []))
                            .catch(() => { });
                        }
                      }}
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
    </AdminLayout>
  );
}
