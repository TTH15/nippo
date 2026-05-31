"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";
import { getDisplayName } from "@/lib/displayName";

type MetricField = { unitId: string; fieldKey: string };
type FieldRow = { id: string; field_key: string; label: string; group_label: string | null };
type UnitRow = { id: string; name: string; code: string | null; fields: FieldRow[] };
type CarrierRow = { id: string; name: string; units: UnitRow[] };
type DriverRow = { id: string; name: string; display_name: string | null };
type Config = {
  metricLabel: string;
  metricFields: MetricField[];
  targetDriverIds: string[];
  period: string;
  showRanking: boolean;
};

const fkid = (unitId: string, fieldKey: string) => `${unitId}|${fieldKey}`;

export default function SubmitScreenConfigPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [carriers, setCarriers] = useState<CarrierRow[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ config: Config; drivers: DriverRow[]; carriers: CarrierRow[] }>(
        "/api/admin/submit-screen",
      );
      setCfg(res.config);
      setDrivers(res.drivers);
      setCarriers(res.carriers);
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

  const toggleField = (unitId: string, fieldKey: string) => {
    setCfg((c) => {
      if (!c) return c;
      const exists = c.metricFields.some((f) => f.unitId === unitId && f.fieldKey === fieldKey);
      return {
        ...c,
        metricFields: exists
          ? c.metricFields.filter((f) => !(f.unitId === unitId && f.fieldKey === fieldKey))
          : [...c.metricFields, { unitId, fieldKey }],
      };
    });
  };

  const toggleDriver = (id: string) => {
    setCfg((c) => {
      if (!c) return c;
      const has = c.targetDriverIds.includes(id);
      return {
        ...c,
        targetDriverIds: has ? c.targetDriverIds.filter((x) => x !== id) : [...c.targetDriverIds, id],
      };
    });
  };

  const save = async () => {
    if (!cfg || !canWrite) return;
    if (cfg.showRanking && cfg.metricFields.length === 0) {
      setError({ title: "入力エラー", message: "ランキングを表示するには、対象の報告項目を1つ以上選択してください。" });
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/admin/submit-screen", { method: "PUT", body: JSON.stringify(cfg) });
      await load();
    } catch (e) {
      setError({ title: "保存に失敗しました", message: e instanceof Error ? e.message : "もう一度お試しください。" });
    } finally {
      setSaving(false);
    }
  };

  const allSelected = cfg && drivers.length > 0 && cfg.targetDriverIds.length === drivers.length;

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">送信後画面（報酬・ランキング）</h1>
          <p className="text-xs text-slate-500 mt-1">
            ドライバーが日報を送信した後に出る「今日の報酬見込み」と「ランキング」を設定します。チーム戦（イベント）が開催中はそのチーム順位、開催していなければここで設定した個人ランキングを表示します。
          </p>
        </div>

        {loading || !cfg ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4">
              <span className="text-sm font-medium text-slate-700">送信後にランキングを表示する</span>
              <button
                type="button"
                role="switch"
                aria-checked={cfg.showRanking}
                onClick={() => canWrite && setCfg({ ...cfg, showRanking: !cfg.showRanking })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cfg.showRanking ? "bg-emerald-600" : "bg-slate-300"}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${cfg.showRanking ? "translate-x-5" : "translate-x-1"}`} />
              </button>
            </label>

            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">ランキング名</label>
                <input
                  value={cfg.metricLabel}
                  onChange={(e) => setCfg({ ...cfg, metricLabel: e.target.value })}
                  disabled={!canWrite}
                  placeholder="例：完了個数"
                  className="w-full max-w-xs px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-600">集計する報告項目（合計でランキング・今月）</label>
                  <span className="text-[11px] text-slate-400">{cfg.metricFields.length}項目を選択中</span>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {carriers.map((c) => (
                    <div key={c.id} className="px-3 py-2">
                      <div className="text-xs font-semibold text-slate-700 mb-1">{c.name}</div>
                      {c.units.map((u) => (
                        <div key={u.id} className="mb-1.5 last:mb-0">
                          <div className="text-[11px] text-slate-400 mb-0.5">{u.name || u.code}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {u.fields.map((f) => {
                              const checked = cfg.metricFields.some((mf) => fkid(mf.unitId, mf.fieldKey) === fkid(u.id, f.field_key));
                              return (
                                <button
                                  key={f.id}
                                  type="button"
                                  disabled={!canWrite}
                                  onClick={() => toggleField(u.id, f.field_key)}
                                  className={`px-2 py-1 rounded-md text-xs border transition-colors ${checked ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"} disabled:opacity-50`}
                                >
                                  {f.group_label ? `${f.group_label} ` : ""}
                                  {f.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-slate-600">
                  ランキング対象ドライバー（{cfg.targetDriverIds.length === 0 ? "全員" : `${cfg.targetDriverIds.length}名`}）
                </label>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => setCfg({ ...cfg, targetDriverIds: allSelected ? [] : drivers.map((d) => d.id) })}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    {allSelected ? "全解除" : "全選択"}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mb-2">未選択（0名）の場合は全ドライバーが対象になります。</p>
              <div className="max-h-56 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {drivers.map((d) => {
                  const on = cfg.targetDriverIds.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      disabled={!canWrite}
                      onClick={() => toggleDriver(d.id)}
                      className={`px-2 py-1.5 rounded-md text-xs border text-left transition-colors ${on ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"} disabled:opacity-50`}
                    >
                      {getDisplayName(d)}
                    </button>
                  );
                })}
              </div>
            </div>

            {canWrite && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="px-5 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <ErrorDialog open={!!error} title={error?.title} message={error?.message ?? ""} onClose={() => setError(null)} />
    </AdminLayout>
  );
}
