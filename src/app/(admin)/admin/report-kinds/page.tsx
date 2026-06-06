"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";

type Capability = "none" | "oil_mileage" | "expense";
type ReportKind = {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  usesLocation: boolean;
  usesOdometer: boolean;
  usesDescription: boolean;
  usesAmount: boolean;
  descriptionRequired: boolean;
  descriptionLabel: string | null;
  capability: Capability;
};

type FormState = {
  id: string | null;
  key: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  usesLocation: boolean;
  usesOdometer: boolean;
  usesDescription: boolean;
  usesAmount: boolean;
  descriptionRequired: boolean;
  descriptionLabel: string;
  capability: Capability;
};

const CAP_LABEL: Record<Capability, string> = {
  none: "なし",
  oil_mileage: "車両距離を更新",
  expense: "経費に連携",
};

const emptyForm = (sortOrder: number): FormState => ({
  id: null,
  key: "",
  label: "",
  sortOrder,
  isActive: true,
  usesLocation: true,
  usesOdometer: false,
  usesDescription: true,
  usesAmount: false,
  descriptionRequired: true,
  descriptionLabel: "",
  capability: "none",
});

export default function ReportKindsPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [kinds, setKinds] = useState<ReportKind[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReportKind | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ kinds: ReportKind[] }>("/api/admin/report-kinds");
      setKinds(res.kinds ?? []);
    } catch (e) {
      setError({ title: "読み込みに失敗しました", message: e instanceof Error ? e.message : "もう一度お試しください。" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
    load();
  }, [load]);

  const openNew = () => setForm(emptyForm((kinds.at(-1)?.sortOrder ?? 0) + 1));
  const openEdit = (k: ReportKind) =>
    setForm({ ...k, descriptionLabel: k.descriptionLabel ?? "" });

  const save = async () => {
    if (!form || !canWrite) return;
    // 能力に必要なフィールドの整合性をクライアントでも確認。
    if (form.capability === "oil_mileage" && !form.usesOdometer) {
      setError({ title: "入力エラー", message: "「車両距離を更新」には走行距離フィールドが必要です。" });
      return;
    }
    if (form.capability === "expense" && !form.usesAmount) {
      setError({ title: "入力エラー", message: "「経費に連携」には金額フィールドが必要です。" });
      return;
    }
    setSaving(true);
    try {
      if (form.id) {
        await apiFetch(`/api/admin/report-kinds/${form.id}`, { method: "PATCH", body: JSON.stringify(form) });
      } else {
        await apiFetch("/api/admin/report-kinds", { method: "POST", body: JSON.stringify(form) });
      }
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

  const fieldChips = (k: ReportKind) =>
    [
      k.usesLocation && "場所",
      k.usesOdometer && "走行距離",
      k.usesDescription && (k.descriptionLabel || "内容"),
      k.usesAmount && "金額",
    ].filter(Boolean) as string[];

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">報告種別の設定</h1>
            <p className="text-xs text-slate-500 mt-1">
              ドライバーの諸報告（オイル交換・修理・経費など）の種類と、使う入力項目・承認時の動作を設定します。
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={openNew}
              className="shrink-0 px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700"
            >
              新規追加
            </button>
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
                className={`rounded-lg border bg-white p-3 ${k.isActive ? "border-slate-200" : "border-slate-200 opacity-60"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900">{k.label}</span>
                      <span className="font-mono text-[11px] text-slate-400">{k.key}</span>
                      {!k.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">無効</span>
                      )}
                      {k.capability !== "none" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                          {CAP_LABEL[k.capability]}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {fieldChips(k).map((c) => (
                        <span key={c} className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEdit(k)}
                        className="px-2.5 py-1 text-xs rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(k)}
                        className="px-2.5 py-1 text-xs rounded border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                      >
                        削除
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 追加/編集モーダル */}
      {form && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">{form.id ? "報告種別を編集" : "報告種別を追加"}</h2>
            <div className="space-y-4">
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

              <div>
                <div className="text-xs font-medium text-slate-600 mb-1.5">使う入力項目</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "usesLocation" as const, label: "場所" },
                    { key: "usesOdometer" as const, label: "走行距離" },
                    { key: "usesDescription" as const, label: "内容（自由記述）" },
                    { key: "usesAmount" as const, label: "金額" },
                  ].map((f) => (
                    <label key={f.key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form[f.key]}
                        onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>

              {form.usesDescription && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">内容のラベル（任意）</label>
                    <input
                      value={form.descriptionLabel}
                      onChange={(e) => setForm({ ...form, descriptionLabel: e.target.value })}
                      placeholder="例：依頼内容"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700 mt-6">
                    <input
                      type="checkbox"
                      checked={form.descriptionRequired}
                      onChange={(e) => setForm({ ...form, descriptionRequired: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    内容を必須にする
                  </label>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">承認時の動作</label>
                <select
                  value={form.capability}
                  onChange={(e) => setForm({ ...form, capability: e.target.value as Capability })}
                  className="w-full max-w-xs px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="none">なし</option>
                  <option value="oil_mileage">車両の前回オイル交換距離を更新（走行距離が必要）</option>
                  <option value="expense">臨時経費に連携しペイメント算入（金額が必要）</option>
                </select>
              </div>

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
              <button
                type="button"
                onClick={() => setForm(null)}
                className="px-4 py-2 text-sm bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="px-4 py-2 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50"
              >
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
