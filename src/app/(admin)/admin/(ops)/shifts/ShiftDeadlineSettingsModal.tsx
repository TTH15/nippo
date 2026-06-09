"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { CustomSelect } from "@/lib/components/CustomSelect";
import {
  DEFAULT_DEADLINE_CONFIG,
  computeDeadline,
  type DeadlineConfig,
  type DeadlineOverride,
  type Half,
} from "@/lib/shiftDeadline";

// ============================================================
// 希望休 提出締切の設定モーダル（管理シフト画面の歯車から開く）。
//   既定ルール: 前半=前月◯日 / 後半=当月◯日 の締切日のみ可変（半月境界は固定）。
//   期間例外: 年×月×半月 ごとに締切日を上書き（GW 等）。
// ============================================================

interface Props {
  open: boolean;
  canWrite: boolean;
  onClose: () => void;
}

type OverrideRow = DeadlineOverride & { _key: string };
type DriverInfo = { id: string; name: string; display_name: string | null };
type DriverRule = { firstHalfDeadlineDay: number; secondHalfDeadlineDay: number };
type DriverOverrideRow = DeadlineOverride & { driverId: string; _key: string };

const driverName = (d: DriverInfo) => d.display_name || d.name;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const formatMd = (ymd: string) => {
  const [, m, d] = ymd.split("-").map(Number);
  return m && d ? `${m}/${d}` : ymd;
};

let keySeq = 0;
const nextKey = () => `ov-${keySeq++}`;

export default function ShiftDeadlineSettingsModal({ open, canWrite, onClose }: Props) {
  const [config, setConfig] = useState<DeadlineConfig>({ ...DEFAULT_DEADLINE_CONFIG });
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [driverRules, setDriverRules] = useState<Record<string, DriverRule>>({});
  const [driverOverrides, setDriverOverrides] = useState<DriverOverrideRow[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    apiFetch<{
      config: DeadlineConfig;
      overrides: DeadlineOverride[];
      driverRules: Record<string, DeadlineConfig>;
      driverOverrides: (DeadlineOverride & { driverId: string })[];
      drivers: DriverInfo[];
    }>("/api/admin/shift-deadlines")
      .then((res) => {
        setConfig({ ...DEFAULT_DEADLINE_CONFIG, ...res.config });
        setOverrides((res.overrides ?? []).map((o) => ({ ...o, _key: nextKey() })));
        setDrivers(res.drivers ?? []);
        const dr: Record<string, DriverRule> = {};
        for (const [id, c] of Object.entries(res.driverRules ?? {})) {
          dr[id] = { firstHalfDeadlineDay: c.firstHalfDeadlineDay, secondHalfDeadlineDay: c.secondHalfDeadlineDay };
        }
        setDriverRules(dr);
        setDriverOverrides((res.driverOverrides ?? []).map((o) => ({ ...o, _key: nextKey() })));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const now = new Date();
  const addOverride = () => {
    setOverrides((prev) => [
      ...prev,
      {
        _key: nextKey(),
        targetYear: now.getFullYear(),
        targetMonth: now.getMonth() + 1,
        half: "FIRST",
        deadlineDate: "",
        note: null,
      },
    ]);
  };

  const updateOverride = (key: string, patch: Partial<DeadlineOverride>) => {
    setOverrides((prev) => prev.map((o) => (o._key === key ? { ...o, ...patch } : o)));
  };
  const removeOverride = (key: string) => {
    setOverrides((prev) => prev.filter((o) => o._key !== key));
  };

  // --- ドライバーごと ---
  const toggleDriverRule = (on: boolean) => {
    if (!selectedDriverId) return;
    setDriverRules((prev) => {
      const next = { ...prev };
      if (on) {
        next[selectedDriverId] = {
          firstHalfDeadlineDay: config.firstHalfDeadlineDay,
          secondHalfDeadlineDay: config.secondHalfDeadlineDay,
        };
      } else {
        delete next[selectedDriverId];
      }
      return next;
    });
  };
  const updateDriverRule = (patch: Partial<DriverRule>) => {
    if (!selectedDriverId) return;
    setDriverRules((prev) => ({ ...prev, [selectedDriverId]: { ...prev[selectedDriverId], ...patch } }));
  };
  const addDriverOverride = () => {
    if (!selectedDriverId) return;
    setDriverOverrides((prev) => [
      ...prev,
      {
        _key: nextKey(),
        driverId: selectedDriverId,
        targetYear: now.getFullYear(),
        targetMonth: now.getMonth() + 1,
        half: "FIRST",
        deadlineDate: "",
        note: null,
      },
    ]);
  };
  const updateDriverOverride = (key: string, patch: Partial<DeadlineOverride>) => {
    setDriverOverrides((prev) => prev.map((o) => (o._key === key ? { ...o, ...patch } : o)));
  };
  const removeDriverOverride = (key: string) => {
    setDriverOverrides((prev) => prev.filter((o) => o._key !== key));
  };
  const thisDriverOverrides = driverOverrides.filter((o) => o.driverId === selectedDriverId);

  const save = async () => {
    // 締切日が空の例外は除外
    const valid = overrides.filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.deadlineDate));
    const validDriverOv = driverOverrides.filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.deadlineDate));
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/admin/shift-deadlines", {
        method: "PUT",
        body: JSON.stringify({
          config: {
            firstHalfDeadlineDay: config.firstHalfDeadlineDay,
            secondHalfDeadlineDay: config.secondHalfDeadlineDay,
          },
          overrides: valid.map((o) => ({
            targetYear: o.targetYear,
            targetMonth: o.targetMonth,
            half: o.half,
            deadlineDate: o.deadlineDate,
            note: o.note ?? null,
          })),
          driverRules,
          driverOverrides: validDriverOv.map((o) => ({
            driverId: o.driverId,
            targetYear: o.targetYear,
            targetMonth: o.targetMonth,
            half: o.half,
            deadlineDate: o.deadlineDate,
            note: o.note ?? null,
          })),
        }),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">希望休 提出締切の設定</h2>
          <p className="text-xs text-slate-500 mb-4">
            前半（1〜15日）・後半（16〜末日）ごとに提出締切を設定します。締切を過ぎた半月はドライバーが編集できなくなります。
          </p>

          {error && (
            <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-slate-500 py-8 text-center">読み込み中…</p>
          ) : (
            <>
              {/* 既定ルール */}
              <section className="mb-6">
                <h3 className="text-sm font-medium text-slate-700 mb-2">既定ルール</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded border border-slate-200 p-3">
                    <div className="text-xs text-slate-500 mb-1">前半（1〜15日）の締切</div>
                    <div className="flex items-center gap-2 text-sm text-slate-800">
                      <span>前月</span>
                      <input
                        type="number"
                        min={1}
                        max={28}
                        disabled={!canWrite}
                        value={config.firstHalfDeadlineDay}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, firstHalfDeadlineDay: Number(e.target.value) || 0 }))
                        }
                        className="w-16 px-2 py-1 border border-slate-200 rounded text-center disabled:bg-slate-50"
                      />
                      <span>日まで</span>
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 p-3">
                    <div className="text-xs text-slate-500 mb-1">後半（16〜末日）の締切</div>
                    <div className="flex items-center gap-2 text-sm text-slate-800">
                      <span>当月</span>
                      <input
                        type="number"
                        min={1}
                        max={28}
                        disabled={!canWrite}
                        value={config.secondHalfDeadlineDay}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, secondHalfDeadlineDay: Number(e.target.value) || 0 }))
                        }
                        className="w-16 px-2 py-1 border border-slate-200 rounded text-center disabled:bg-slate-50"
                      />
                      <span>日まで</span>
                    </div>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  日付は1〜28日で指定（月末ズレ防止）。半月の区切り（1〜15 / 16〜末）は固定です。
                </p>
              </section>

              {/* 期間例外 */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-slate-700">期間ごとの例外</h3>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={addOverride}
                      className="px-2.5 py-1 text-xs font-medium rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      ＋ 例外を追加
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mb-2">
                  GW 等で特定の半月だけ締切を変えたいときに追加します（既定より延長も短縮も可）。
                </p>
                {overrides.length === 0 ? (
                  <p className="text-xs text-slate-400 py-3 text-center bg-slate-50 rounded">
                    例外はありません。
                  </p>
                ) : (
                  <div className="space-y-2">
                    {overrides.map((o) => {
                      const defaultDeadline = computeDeadline(
                        { ...config },
                        [],
                        o.targetYear,
                        o.targetMonth,
                        o.half,
                      );
                      return (
                        <div
                          key={o._key}
                          className="flex flex-wrap items-center gap-2 rounded border border-slate-200 p-2"
                        >
                          <input
                            type="number"
                            min={2000}
                            disabled={!canWrite}
                            value={o.targetYear}
                            onChange={(e) =>
                              updateOverride(o._key, { targetYear: Number(e.target.value) || 0 })
                            }
                            className="w-20 px-2 py-1 text-sm border border-slate-200 rounded disabled:bg-slate-50"
                          />
                          <span className="text-xs text-slate-500">年</span>
                          <CustomSelect
                            disabled={!canWrite}
                            value={String(o.targetMonth)}
                            onChange={(v) =>
                              updateOverride(o._key, { targetMonth: Number(v) })
                            }
                            options={MONTHS.map((m) => ({ value: String(m), label: `${m}月` }))}
                            clearable={false}
                            size="sm"
                          />
                          <CustomSelect
                            disabled={!canWrite}
                            value={o.half}
                            onChange={(v) =>
                              updateOverride(o._key, { half: v as Half })
                            }
                            options={[
                              { value: "FIRST", label: "前半" },
                              { value: "SECOND", label: "後半" },
                            ]}
                            clearable={false}
                            size="sm"
                          />
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-500">締切</span>
                            <input
                              type="date"
                              disabled={!canWrite}
                              value={o.deadlineDate}
                              onChange={(e) =>
                                updateOverride(o._key, { deadlineDate: e.target.value })
                              }
                              className="px-2 py-1 text-sm border border-slate-200 rounded disabled:bg-slate-50"
                            />
                          </div>
                          <span className="text-[11px] text-slate-400">
                            既定: {formatMd(defaultDeadline)}
                          </span>
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => removeOverride(o._key)}
                              className="ml-auto px-2 py-1 text-xs text-rose-600 hover:text-rose-800"
                            >
                              削除
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* ドライバーごとの設定 */}
              <section className="mt-6 border-t border-slate-100 pt-5">
                <h3 className="text-sm font-medium text-slate-700 mb-1">ドライバーごとの設定</h3>
                <p className="text-[11px] text-slate-400 mb-3">
                  特定のドライバーだけ締切を変えられます。優先順位は「ドライバー個別の例外 ＞ ドライバー個別の既定 ＞ 全体の例外 ＞ 全体の既定」です。
                </p>
                <CustomSelect
                  value={selectedDriverId}
                  onChange={(v) => setSelectedDriverId(v)}
                  options={[
                    { value: "", label: "ドライバーを選択…" },
                    ...drivers.map((d) => ({
                      value: d.id,
                      label: driverName(d) + (driverRules[d.id] || driverOverrides.some((o) => o.driverId === d.id) ? "（設定あり）" : ""),
                    })),
                  ]}
                  clearable={false}
                  size="sm"
                />

                {selectedDriverId && (
                  <div className="mt-3 space-y-4">
                    {/* 個別の既定ルール */}
                    <div className="rounded border border-slate-200 p-3">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          disabled={!canWrite}
                          checked={!!driverRules[selectedDriverId]}
                          onChange={(e) => toggleDriverRule(e.target.checked)}
                        />
                        この人の既定締切を個別に設定する
                      </label>
                      {driverRules[selectedDriverId] ? (
                        <div className="grid grid-cols-2 gap-4 mt-3">
                          <div className="flex items-center gap-2 text-sm text-slate-800">
                            <span className="text-xs text-slate-500">前半</span>
                            <span>前月</span>
                            <input
                              type="number"
                              min={1}
                              max={28}
                              disabled={!canWrite}
                              value={driverRules[selectedDriverId].firstHalfDeadlineDay}
                              onChange={(e) => updateDriverRule({ firstHalfDeadlineDay: Number(e.target.value) || 0 })}
                              className="w-16 px-2 py-1 border border-slate-200 rounded text-center disabled:bg-slate-50"
                            />
                            <span>日</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-slate-800">
                            <span className="text-xs text-slate-500">後半</span>
                            <span>当月</span>
                            <input
                              type="number"
                              min={1}
                              max={28}
                              disabled={!canWrite}
                              value={driverRules[selectedDriverId].secondHalfDeadlineDay}
                              onChange={(e) => updateDriverRule({ secondHalfDeadlineDay: Number(e.target.value) || 0 })}
                              className="w-16 px-2 py-1 border border-slate-200 rounded text-center disabled:bg-slate-50"
                            />
                            <span>日</span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 mt-2">
                          未設定: 全体の既定（前月{config.firstHalfDeadlineDay}日 / 当月{config.secondHalfDeadlineDay}日）に従います。
                        </p>
                      )}
                    </div>

                    {/* 個別の期間例外 */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-medium text-slate-600">この人の期間例外</h4>
                        {canWrite && (
                          <button
                            type="button"
                            onClick={addDriverOverride}
                            className="px-2.5 py-1 text-xs font-medium rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          >
                            ＋ 例外を追加
                          </button>
                        )}
                      </div>
                      {thisDriverOverrides.length === 0 ? (
                        <p className="text-xs text-slate-400 py-3 text-center bg-slate-50 rounded">
                          この人の例外はありません。
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {thisDriverOverrides.map((o) => (
                            <div
                              key={o._key}
                              className="flex flex-wrap items-center gap-2 rounded border border-slate-200 p-2"
                            >
                              <input
                                type="number"
                                min={2000}
                                disabled={!canWrite}
                                value={o.targetYear}
                                onChange={(e) => updateDriverOverride(o._key, { targetYear: Number(e.target.value) || 0 })}
                                className="w-20 px-2 py-1 text-sm border border-slate-200 rounded disabled:bg-slate-50"
                              />
                              <span className="text-xs text-slate-500">年</span>
                              <CustomSelect
                                disabled={!canWrite}
                                value={String(o.targetMonth)}
                                onChange={(v) => updateDriverOverride(o._key, { targetMonth: Number(v) })}
                                options={MONTHS.map((m) => ({ value: String(m), label: `${m}月` }))}
                                clearable={false}
                                size="sm"
                              />
                              <CustomSelect
                                disabled={!canWrite}
                                value={o.half}
                                onChange={(v) => updateDriverOverride(o._key, { half: v as Half })}
                                options={[
                                  { value: "FIRST", label: "前半" },
                                  { value: "SECOND", label: "後半" },
                                ]}
                                clearable={false}
                                size="sm"
                              />
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-slate-500">締切</span>
                                <input
                                  type="date"
                                  disabled={!canWrite}
                                  value={o.deadlineDate}
                                  onChange={(e) => updateDriverOverride(o._key, { deadlineDate: e.target.value })}
                                  className="px-2 py-1 text-sm border border-slate-200 rounded disabled:bg-slate-50"
                                />
                              </div>
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={() => removeDriverOverride(o._key)}
                                  className="ml-auto px-2 py-1 text-xs text-rose-600 hover:text-rose-800"
                                >
                                  削除
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
            >
              閉じる
            </button>
            {canWrite && (
              <button
                type="button"
                onClick={save}
                disabled={saving || loading}
                className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? "保存中…" : "保存"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
