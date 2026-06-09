"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { CustomSelect } from "@/lib/components/CustomSelect";
import type { DeadlineRule, RulePeriod, RulePeriodOverride } from "@/lib/shiftDeadline";

// ============================================================
// 希望休 提出締切の設定モーダル（ルール方式）。
//   ルール = 名前 ＋ 提出期間リスト（自由な日割り）＋ 期間例外。
//   ドライバーをルールに割り当て（ルール側で複数選択）。未割り当て＝常に提出可。
// ============================================================

interface Props {
  open: boolean;
  canWrite: boolean;
  onClose: () => void;
}

type DriverInfo = { id: string; name: string; display_name: string | null };
type PeriodRow = RulePeriod & { _key: string };
type OverrideRow = RulePeriodOverride & { _key: string };
type RuleRow = {
  _key: string;
  name: string;
  periods: PeriodRow[];
  overrides: OverrideRow[];
  driverIds: string[];
};
type RuleFull = DeadlineRule & { sortOrder: number; driverIds: string[] };

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const OFFSETS = [
  { value: "-1", label: "前月" },
  { value: "0", label: "当月" },
  { value: "1", label: "翌月" },
];
const driverName = (d: DriverInfo) => d.display_name || d.name;

let keySeq = 0;
const nextKey = () => `k-${keySeq++}`;

const PRESETS: { label: string; periods: Omit<RulePeriod, "seq">[] }[] = [
  { label: "月1回", periods: [{ startDay: 1, endDay: 31, deadlineMonthOffset: -1, deadlineDay: 23 }] },
  {
    label: "半月（月2回）",
    periods: [
      { startDay: 1, endDay: 15, deadlineMonthOffset: -1, deadlineDay: 23 },
      { startDay: 16, endDay: 31, deadlineMonthOffset: 0, deadlineDay: 10 },
    ],
  },
  {
    label: "旬（月3回）",
    periods: [
      { startDay: 1, endDay: 10, deadlineMonthOffset: -1, deadlineDay: 23 },
      { startDay: 11, endDay: 20, deadlineMonthOffset: -1, deadlineDay: 28 },
      { startDay: 21, endDay: 31, deadlineMonthOffset: 0, deadlineDay: 5 },
    ],
  },
];

const mkPeriod = (p: Omit<RulePeriod, "seq">, seq: number): PeriodRow => ({ ...p, seq, _key: nextKey() });

export default function ShiftDeadlineSettingsModal({ open, canWrite, onClose }: Props) {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    apiFetch<{ rules: RuleFull[]; drivers: DriverInfo[] }>("/api/admin/shift-deadlines")
      .then((res) => {
        const ds = res.drivers ?? [];
        setDrivers(ds);
        // 実ドライバー以外（管理者・閲覧専用など、一覧に出ないID）は割り当てから除外。
        const validIds = new Set(ds.map((d) => d.id));
        setRules(
          (res.rules ?? []).map((r) => ({
            _key: nextKey(),
            name: r.name,
            periods: (r.periods ?? []).map((p) => ({ ...p, _key: nextKey() })),
            overrides: (r.overrides ?? []).map((o) => ({ ...o, _key: nextKey() })),
            driverIds: (r.driverIds ?? []).filter((id) => validIds.has(id)),
          })),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const now = new Date();
  const patchRule = (key: string, patch: Partial<RuleRow>) =>
    setRules((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));

  const addRule = () =>
    setRules((prev) => [
      ...prev,
      { _key: nextKey(), name: "新しいルール", periods: PRESETS[1].periods.map(mkPeriod), overrides: [], driverIds: [] },
    ]);
  const removeRule = (key: string) => setRules((prev) => prev.filter((r) => r._key !== key));

  const applyPreset = (ruleKey: string, presetIdx: number) =>
    patchRule(ruleKey, { periods: PRESETS[presetIdx].periods.map(mkPeriod), overrides: [] });

  const addPeriod = (rule: RuleRow) =>
    patchRule(rule._key, {
      periods: [...rule.periods, mkPeriod({ startDay: 1, endDay: 31, deadlineMonthOffset: -1, deadlineDay: 23 }, rule.periods.length)],
    });
  const updatePeriod = (rule: RuleRow, pKey: string, patch: Partial<RulePeriod>) =>
    patchRule(rule._key, { periods: rule.periods.map((p) => (p._key === pKey ? { ...p, ...patch } : p)) });
  const removePeriod = (rule: RuleRow, pKey: string) =>
    patchRule(rule._key, {
      // 削除後に seq を振り直し、その期間を参照していた例外は落とす。
      periods: rule.periods.filter((p) => p._key !== pKey).map((p, i) => ({ ...p, seq: i })),
      overrides: [],
    });

  const addOverride = (rule: RuleRow) =>
    patchRule(rule._key, {
      overrides: [
        ...rule.overrides,
        { _key: nextKey(), targetYear: now.getFullYear(), targetMonth: now.getMonth() + 1, periodSeq: 0, deadlineDate: "", note: null },
      ],
    });
  const updateOverride = (rule: RuleRow, oKey: string, patch: Partial<RulePeriodOverride>) =>
    patchRule(rule._key, { overrides: rule.overrides.map((o) => (o._key === oKey ? { ...o, ...patch } : o)) });
  const removeOverride = (rule: RuleRow, oKey: string) =>
    patchRule(rule._key, { overrides: rule.overrides.filter((o) => o._key !== oKey) });

  // ドライバーを1ルールにだけ割り当て（チェックで他ルールから外す）。
  const toggleDriver = (ruleKey: string, driverId: string) =>
    setRules((prev) =>
      prev.map((r) => {
        if (r._key === ruleKey) {
          const has = r.driverIds.includes(driverId);
          return { ...r, driverIds: has ? r.driverIds.filter((d) => d !== driverId) : [...r.driverIds, driverId] };
        }
        return { ...r, driverIds: r.driverIds.filter((d) => d !== driverId) };
      }),
    );

  const assignedSet = new Set(rules.flatMap((r) => r.driverIds));
  const unassigned = drivers.filter((d) => !assignedSet.has(d.id));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/admin/shift-deadlines", {
        method: "PUT",
        body: JSON.stringify({
          rules: rules.map((r) => ({
            name: r.name,
            periods: r.periods.map((p) => ({
              startDay: p.startDay,
              endDay: p.endDay,
              deadlineMonthOffset: p.deadlineMonthOffset,
              deadlineDay: p.deadlineDay,
            })),
            overrides: r.overrides
              .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.deadlineDate))
              .map((o) => ({
                targetYear: o.targetYear,
                targetMonth: o.targetMonth,
                periodSeq: o.periodSeq,
                deadlineDate: o.deadlineDate,
                note: o.note ?? null,
              })),
            driverIds: r.driverIds,
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
            締切「ルール」を作り、ドライバーを割り当てます。ルールは提出期間（月1回・半月・旬・任意）を自由に設定でき、各期間に締切を決めます。
            どのルールにも割り当てられていない人は常に提出可です。
          </p>

          {error && (
            <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
          )}

          {loading ? (
            <p className="text-sm text-slate-500 py-8 text-center">読み込み中…</p>
          ) : (
            <>
              <div className="space-y-4">
                {rules.map((rule) => (
                  <div key={rule._key} className="rounded-lg border border-slate-200 p-3">
                    {/* 名前 + 削除 */}
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        type="text"
                        disabled={!canWrite}
                        value={rule.name}
                        onChange={(e) => patchRule(rule._key, { name: e.target.value })}
                        placeholder="ルール名"
                        className="flex-1 px-3 py-1.5 text-sm font-medium border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50"
                      />
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => removeRule(rule._key)}
                          className="px-2 py-1 text-xs text-rose-600 hover:text-rose-800"
                        >
                          ルール削除
                        </button>
                      )}
                    </div>

                    {/* 提出期間 */}
                    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 mb-2.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-700">提出期間</span>
                        {canWrite && (
                          <div className="flex items-center gap-1">
                            {PRESETS.map((p, i) => (
                              <button
                                key={p.label}
                                type="button"
                                onClick={() => applyPreset(rule._key, i)}
                                className="px-2 py-0.5 text-[11px] rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {rule.periods.map((p) => (
                          <div key={p._key} className="flex flex-wrap items-center gap-1.5 text-sm bg-white rounded border border-slate-200 px-2 py-1.5">
                            <input
                              type="number"
                              min={1}
                              max={31}
                              disabled={!canWrite}
                              value={p.startDay}
                              onChange={(e) => updatePeriod(rule, p._key, { startDay: Number(e.target.value) || 1 })}
                              className="w-12 px-1.5 py-1 border border-slate-200 rounded text-center disabled:bg-slate-50"
                            />
                            <span className="text-slate-400">〜</span>
                            <input
                              type="number"
                              min={1}
                              max={31}
                              disabled={!canWrite}
                              value={p.endDay}
                              onChange={(e) => updatePeriod(rule, p._key, { endDay: Number(e.target.value) || 1 })}
                              className="w-12 px-1.5 py-1 border border-slate-200 rounded text-center disabled:bg-slate-50"
                            />
                            <span className="text-xs text-slate-500">日</span>
                            <span className="mx-1 text-slate-300">｜</span>
                            <span className="text-xs text-slate-500">締切</span>
                            <CustomSelect
                              disabled={!canWrite}
                              value={String(p.deadlineMonthOffset)}
                              onChange={(v) => updatePeriod(rule, p._key, { deadlineMonthOffset: Number(v) })}
                              options={OFFSETS}
                              clearable={false}
                              size="sm"
                              className="w-20"
                            />
                            <input
                              type="number"
                              min={1}
                              max={28}
                              disabled={!canWrite}
                              value={p.deadlineDay}
                              onChange={(e) => updatePeriod(rule, p._key, { deadlineDay: Number(e.target.value) || 1 })}
                              className="w-12 px-1.5 py-1 border border-slate-200 rounded text-center disabled:bg-slate-50"
                            />
                            <span className="text-xs text-slate-500">日まで</span>
                            {canWrite && rule.periods.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removePeriod(rule, p._key)}
                                className="ml-auto px-1.5 py-1 text-xs text-rose-600 hover:text-rose-800"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => addPeriod(rule)}
                          className="mt-1.5 px-2 py-0.5 text-[11px] rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                        >
                          ＋ 期間を追加
                        </button>
                      )}
                    </div>

                    {/* 期間例外 */}
                    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3 mb-2.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-700">期間例外（GW等）</span>
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => addOverride(rule)}
                            className="px-2 py-0.5 text-[11px] rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                          >
                            ＋ 例外
                          </button>
                        )}
                      </div>
                      {rule.overrides.length === 0 ? (
                        <p className="text-[11px] text-slate-400">なし</p>
                      ) : (
                        <div className="space-y-1.5">
                          {rule.overrides.map((o) => (
                            <div key={o._key} className="flex flex-wrap items-center gap-1.5 text-sm">
                              <input
                                type="number"
                                min={2000}
                                disabled={!canWrite}
                                value={o.targetYear}
                                onChange={(e) => updateOverride(rule, o._key, { targetYear: Number(e.target.value) || 0 })}
                                className="w-20 px-2 py-1 border border-slate-200 rounded disabled:bg-slate-50"
                              />
                              <CustomSelect
                                disabled={!canWrite}
                                value={String(o.targetMonth)}
                                onChange={(v) => updateOverride(rule, o._key, { targetMonth: Number(v) })}
                                options={MONTHS.map((m) => ({ value: String(m), label: `${m}月` }))}
                                clearable={false}
                                size="sm"
                                className="w-20"
                              />
                              <CustomSelect
                                disabled={!canWrite}
                                value={String(o.periodSeq)}
                                onChange={(v) => updateOverride(rule, o._key, { periodSeq: Number(v) })}
                                options={rule.periods.map((p, i) => ({ value: String(i), label: `${p.startDay}〜${p.endDay}日` }))}
                                clearable={false}
                                size="sm"
                                className="w-28"
                              />
                              <input
                                type="date"
                                disabled={!canWrite}
                                value={o.deadlineDate}
                                onChange={(e) => updateOverride(rule, o._key, { deadlineDate: e.target.value })}
                                className="px-2 py-1 text-sm border border-slate-200 rounded disabled:bg-slate-50"
                              />
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={() => removeOverride(rule, o._key)}
                                  className="ml-auto px-1.5 py-1 text-xs text-rose-600 hover:text-rose-800"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 対象ドライバー */}
                    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
                      <span className="text-xs font-semibold text-slate-700">
                        対象ドライバー（{rule.driverIds.length}人）
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5 mb-2">名前をタップで割り当て（選択中は濃色）。1人は1ルールのみ。</p>
                      <div className="flex flex-wrap gap-1.5">
                        {drivers.map((d) => {
                          const on = rule.driverIds.includes(d.id);
                          return (
                            <button
                              key={d.id}
                              type="button"
                              disabled={!canWrite}
                              onClick={() => toggleDriver(rule._key, d.id)}
                              className={`px-2.5 py-1 text-xs rounded-full border transition-colors disabled:opacity-50 ${
                                on
                                  ? "bg-slate-800 border-slate-800 text-white"
                                  : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              {driverName(d)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {canWrite && (
                <button
                  type="button"
                  onClick={addRule}
                  className="mt-3 px-3 py-1.5 text-xs font-medium rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                >
                  ＋ ルールを追加
                </button>
              )}

              {/* 未割り当て */}
              <div className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="text-sm font-medium text-slate-700 mb-1">
                  未割り当て（常に提出可）: {unassigned.length}人
                </h3>
                {unassigned.length === 0 ? (
                  <p className="text-[11px] text-slate-400">全員いずれかのルールに割り当て済みです。</p>
                ) : (
                  <p className="text-xs text-slate-500">{unassigned.map(driverName).join("、")}</p>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">
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
