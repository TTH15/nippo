"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { canAdminWrite } from "@/lib/authz";
import { Button } from "@/lib/ui/button";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrashCan, faChevronRight, faPlus } from "@fortawesome/free-solid-svg-icons";
import { CustomSelect } from "@/lib/components/CustomSelect";
import {
  FIELD_TYPE_LABEL,
  validateKindFields,
  type FieldType,
  type FieldRole,
  type ReportField,
  type VehicleMode,
} from "@/server/reportKinds/fields";

type Capability = "none" | "oil_mileage" | "expense";
type ReportKind = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  capability: Capability;
  vehicleMode: VehicleMode;
  fields: ReportField[];
};

type FormState = {
  id: string | null;
  key: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  capability: Capability;
  vehicleMode: VehicleMode;
  fields: ReportField[];
};

const CAP_LABEL: Record<Capability, string> = {
  none: "なし",
  oil_mileage: "車両距離を更新",
  expense: "経費に連携",
};
const VEHICLE_LABEL: Record<VehicleMode, string> = { required: "必須", optional: "任意", none: "なし" };
const FIELD_TYPE_OPTIONS = (Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => ({ value: t, label: FIELD_TYPE_LABEL[t] }));

const newFieldId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? `f_${crypto.randomUUID().slice(0, 8)}` : `f_${Math.floor(Math.random() * 1e9)}`;

function makeField(type: FieldType): ReportField {
  const f: ReportField = { id: newFieldId(), type, label: "", required: false, role: "none" };
  if (type === "select" || type === "multiselect") f.options = [{ value: "選択肢1", label: "選択肢1" }];
  return f;
}

const emptyForm = (sortOrder: number): FormState => ({
  id: null,
  key: "",
  label: "",
  sortOrder,
  isActive: true,
  capability: "none",
  vehicleMode: "required",
  fields: [],
});

export default function ReportKindsPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [kinds, setKinds] = useState<ReportKind[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReportKind | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  // SWR でキャッシュし、遷移をまたいで保持する（再訪時の点滅をなくす）。
  const {
    data: kindsData,
    error: kindsError,
    isInitialLoading,
    mutate: mutateKinds,
  } = useApi<{ kinds: ReportKind[] }>("/api/admin/report-kinds");
  const loading = isInitialLoading;

  useEffect(() => {
    if (kindsData) setKinds(kindsData.kinds ?? []);
  }, [kindsData]);

  useEffect(() => {
    if (kindsError) {
      setError({
        title: "読み込みに失敗しました",
        message: kindsError instanceof Error ? kindsError.message : "もう一度お試しください。",
      });
    }
  }, [kindsError]);

  // 書き込み後の再取得（旧 load の代替）。
  const load = useCallback(() => mutateKinds(), [mutateKinds]);

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
  }, []);

  const openNew = () => setForm(emptyForm((kinds.at(-1)?.sortOrder ?? 0) + 1));
  const openEdit = (k: ReportKind) => setForm({ ...k, fields: k.fields.map((f) => ({ ...f })) });

  // --- フィールド編集 ---
  const setFields = (fn: (f: ReportField[]) => ReportField[]) => setForm((s) => (s ? { ...s, fields: fn(s.fields) } : s));
  const addField = (type: FieldType) => setFields((fs) => [...fs, makeField(type)]);
  const updateField = (id: string, patch: Partial<ReportField>) =>
    setFields((fs) => fs.map((f) => (f.id === id ? ({ ...f, ...patch } as ReportField) : f)));
  const removeField = (id: string) => setFields((fs) => fs.filter((f) => f.id !== id));
  const moveField = (id: string, dir: -1 | 1) =>
    setFields((fs) => {
      const i = fs.findIndex((f) => f.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= fs.length) return fs;
      const copy = [...fs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const save = async () => {
    if (!form || !canWrite) return;
    const check = validateKindFields(form.fields, form.vehicleMode, form.capability);
    if (!check.ok) {
      setError({ title: "入力エラー", message: check.message });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        label: form.label,
        key: form.key,
        sortOrder: form.sortOrder,
        isActive: form.isActive,
        capability: form.capability,
        vehicleMode: form.vehicleMode,
        fields: form.fields,
      };
      if (form.id) await apiFetch(`/api/admin/report-kinds/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await apiFetch("/api/admin/report-kinds", { method: "POST", body: JSON.stringify(payload) });
      setForm(null);
      await load();
    } catch (e) {
      setError({ title: "保存に失敗しました", message: e instanceof Error ? e.message : "もう一度お試しください。" });
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/api/admin/report-kinds/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } catch (e) {
      setError({ title: "削除に失敗しました", message: e instanceof Error ? e.message : "もう一度お試しください。" });
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">報告種別の設定</h1>
            <p className="text-xs text-slate-500 mt-1">
              ドライバーの諸報告の種類ごとに、入力フォーム（フィールド）を自由に組み立てます。
            </p>
          </div>
          {canWrite && (
            <Button type="button" variant="default" size="default" onClick={openNew} className="shrink-0">
              新規追加
            </Button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : kinds.length === 0 ? (
          <p className="text-sm text-slate-500">報告種別がありません。「新規追加」から作成してください。</p>
        ) : (
          <div className="space-y-2">
            {kinds.map((k) => (
              <div
                key={k.id}
                onClick={() => canWrite && openEdit(k)}
                role={canWrite ? "button" : undefined}
                tabIndex={canWrite ? 0 : undefined}
                onKeyDown={(e) => {
                  if (canWrite && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    openEdit(k);
                  }
                }}
                className={`rounded-lg border bg-white p-3 ${k.isActive ? "border-slate-200" : "border-slate-200 opacity-60"} ${canWrite ? "cursor-pointer hover:border-slate-300 hover:shadow-sm active:bg-slate-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900">{k.label}</span>
                      <span className="font-mono text-[11px] text-slate-400">{k.key}</span>
                      {!k.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">無効</span>}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">車両: {VEHICLE_LABEL[k.vehicleMode]}</span>
                      {k.capability !== "none" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">{CAP_LABEL[k.capability]}</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {k.fields.length === 0 ? (
                        <span className="text-[11px] text-slate-400">フィールドなし</span>
                      ) : (
                        k.fields.map((f) => (
                          <span key={f.id} className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                            {f.label || FIELD_TYPE_LABEL[f.type]}
                            {f.required && <span className="text-red-400">*</span>}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(k);
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                        title="削除"
                      >
                        <FontAwesomeIcon icon={faTrashCan} className="h-3.5 w-3.5" />
                      </button>
                      <FontAwesomeIcon icon={faChevronRight} className="h-3.5 w-3.5 text-slate-300" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{form.id ? "報告種別を編集" : "報告種別を追加"}</h2>
            <div className="space-y-5">
              {/* 基本 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">表示名</label>
                  <input
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    placeholder="例：高速代"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    キー（英字）{form.id && <span className="text-slate-400">※変更不可</span>}
                  </label>
                  <input
                    value={form.key}
                    onChange={(e) => setForm({ ...form, key: e.target.value })}
                    disabled={!!form.id}
                    placeholder="例：toll"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>
              </div>

              {/* 車両モード */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">車両の選択</label>
                <div className="flex gap-2">
                  {(["required", "optional", "none"] as VehicleMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setForm({ ...form, vehicleMode: m })}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium border ${form.vehicleMode === m ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200"}`}
                    >
                      {VEHICLE_LABEL[m]}
                    </button>
                  ))}
                </div>
              </div>

              {/* フィールドビルダー */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-600">入力フィールド</label>
                  <span className="text-[11px] text-slate-400">{form.fields.length}個</span>
                </div>
                <div className="space-y-2">
                  {form.fields.map((f, i) => (
                    <FieldEditor
                      key={f.id}
                      field={f}
                      index={i}
                      count={form.fields.length}
                      onUpdate={(p) => updateField(f.id, p)}
                      onMove={(d) => moveField(f.id, d)}
                      onRemove={() => removeField(f.id)}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {FIELD_TYPE_OPTIONS.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => addField(t.value)}
                      className="px-2.5 py-1.5 text-[11px] rounded-md border border-dashed border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                    >
                      ＋ {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 承認時の動作 */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">承認時の動作（API連携）</label>
                <CustomSelect
                  value={form.capability}
                  onChange={(v) => setForm({ ...form, capability: v as Capability })}
                  clearable={false}
                  className="max-w-md"
                  options={[
                    { value: "none", label: "なし" },
                    { value: "oil_mileage", label: "車両の前回オイル交換距離を更新（走行距離フィールド＋車両必須）" },
                    { value: "expense", label: "臨時経費に連携しペイメント算入（金額フィールド必須）" },
                  ]}
                />
                {form.capability !== "none" && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    連携には数値フィールドを「
                    {form.capability === "oil_mileage" ? "走行距離（連携）" : "金額（連携）"}
                    」役割に設定してください（各フィールドの「連携」欄）。
                  </p>
                )}
              </div>

              {/* 並び順・有効 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">並び順</label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700 mt-6">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  ドライバーに表示する（有効）
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setForm(null)} className="px-4 py-2 text-sm bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300">
                キャンセル
              </button>
              <button type="button" onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50">
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="報告種別を削除"
        message={`「${deleteTarget?.label ?? ""}」を削除しますか？既存の報告データは残りますが、表示名はキーになります。`}
        onConfirm={doDelete}
        onClose={() => setDeleteTarget(null)}
      />
      <ErrorDialog open={!!error} title={error?.title} message={error?.message ?? ""} onClose={() => setError(null)} />
    </AdminLayout>
  );
}

function FieldEditor({
  field,
  index,
  count,
  onUpdate,
  onMove,
  onRemove,
}: {
  field: ReportField;
  index: number;
  count: number;
  onUpdate: (patch: Partial<ReportField>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const isChoice = field.type === "select" || field.type === "multiselect";
  const opts = field.options ?? [];
  const setOption = (i: number, label: string) => {
    const next = opts.map((o, k) => (k === i ? { value: label, label } : o));
    onUpdate({ options: next });
  };
  const addOption = () => onUpdate({ options: [...opts, { value: `選択肢${opts.length + 1}`, label: `選択肢${opts.length + 1}` }] });
  const removeOption = (i: number) => onUpdate({ options: opts.filter((_, k) => k !== i) });

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      <div className="flex items-center gap-2">
        <div className="w-32 shrink-0">
          <CustomSelect
            value={field.type}
            onChange={(v) => onUpdate({ type: v as FieldType, options: v === "select" || v === "multiselect" ? (field.options ?? [{ value: "選択肢1", label: "選択肢1" }]) : undefined, role: v === "number" ? field.role : "none" })}
            clearable={false}
            size="sm"
            options={FIELD_TYPE_OPTIONS}
          />
        </div>
        <input
          value={field.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="ラベル"
          className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label="上へ" className="h-8 w-8 rounded-md border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-white">↑</button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="下へ" className="h-8 w-8 rounded-md border border-slate-200 text-slate-500 disabled:opacity-30 hover:bg-white">↓</button>
          <button type="button" onClick={onRemove} aria-label="削除" className="h-8 w-8 rounded-md border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200">×</button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 pl-1">
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={field.required} onChange={(e) => onUpdate({ required: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
          必須
        </label>
        {field.type === "number" && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            連携:
            <select
              value={field.role ?? "none"}
              onChange={(e) => onUpdate({ role: e.target.value as FieldRole })}
              className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white"
            >
              <option value="none">なし</option>
              <option value="odometer">走行距離（車両更新）</option>
              <option value="amount">金額（経費連携）</option>
            </select>
          </label>
        )}
      </div>

      {isChoice && (
        <div className="mt-2 pl-1">
          <div className="text-[11px] text-slate-500 mb-1">選択肢</div>
          <div className="space-y-1">
            {opts.map((o, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  value={o.label}
                  onChange={(e) => setOption(i, e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <button type="button" onClick={() => removeOption(i)} className="h-7 w-7 rounded text-slate-400 hover:text-red-600">×</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addOption} className="mt-1 text-[11px] text-slate-500 hover:text-slate-800">
            <FontAwesomeIcon icon={faPlus} className="mr-1" />選択肢を追加
          </button>
        </div>
      )}
    </div>
  );
}
