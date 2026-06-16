"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { DatePicker } from "@/lib/components/DatePicker";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
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
  /** 親モーダル（タブ）に埋め込む場合はオーバーレイ/カードを描かない。 */
  embedded?: boolean;
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

const OFFSETS = [
  { value: "-1", label: "前月" },
  { value: "0", label: "当月" },
  { value: "1", label: "翌月" },
];
// 締切月オフセット → サマリ表示用ラベル（CustomSelect は前月〜翌月だが ±2 も保存され得る）。
const OFFSET_LABELS: Record<number, string> = { [-2]: "前々月", [-1]: "前月", 0: "当月", 1: "翌月", 2: "翌々月" };
const offsetLabel = (o: number): string => OFFSET_LABELS[o] ?? `${Math.abs(o)}ヶ月${o < 0 ? "前" : "後"}`;
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

// 期間例外の日付（"YYYY-MM-DD" 文字列）と DatePicker（Date）の相互変換。
const ymdToDate = (s: string): Date | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
};
const dateToYmd = (d: Date | undefined): string => {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function ShiftDeadlineSettingsModal({ open, canWrite, onClose, embedded = false }: Props) {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 折りたたみ編集: 展開中（編集モード）のルール key 集合。閲覧時はサマリのみ表示。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    if (!open && !embedded) return;
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
  }, [open, embedded]);

  if (!open && !embedded) return null;

  const now = new Date();
  const patchRule = (key: string, patch: Partial<RuleRow>) =>
    setRules((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));

  const addRule = () => {
    const key = nextKey();
    setRules((prev) => [
      ...prev,
      { _key: key, name: "新しいルール", periods: PRESETS[1].periods.map(mkPeriod), overrides: [], driverIds: [] },
    ]);
    // 追加直後は編集モードで開く。
    setExpanded((prev) => new Set(prev).add(key));
  };
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
    <div className={embedded ? "" : "fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"}>
      <div className={embedded ? "" : "bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto"}>
        <div className={embedded ? "" : "p-6"}>
          {!embedded && (
            <h2 className="text-lg font-semibold text-slate-900 mb-1">希望休 提出締切の設定</h2>
          )}
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
                {rules.map((rule) => {
                  const isEditing = canWrite && expanded.has(rule._key);

                  // 閲覧モード: 読めるサマリだけを表示（既定）。
                  if (!isEditing) {
                    return (
                      <div key={rule._key} className="rounded-lg border border-slate-200 p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900 truncate">{rule.name}</span>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                                対象{rule.driverIds.length}人
                              </span>
                            </div>
                            <ul className="mt-2 space-y-1">
                              {rule.periods.map((p) => (
                                <li key={p._key} className="flex items-baseline gap-2 text-sm">
                                  <span className="w-[5.5rem] shrink-0 tabular-nums text-slate-500">
                                    {p.startDay}〜{p.endDay}日分
                                  </span>
                                  <span className="text-slate-300">→</span>
                                  <span className="font-medium text-slate-800">
                                    {offsetLabel(p.deadlineMonthOffset)} {p.deadlineDay}日 締切
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {rule.overrides.length > 0 && (
                              <p className="mt-2 text-[11px] text-amber-700">期間例外 {rule.overrides.length}件あり</p>
                            )}
                          </div>
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => toggleExpand(rule._key)}
                              className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              編集
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  // 編集モード: その行だけ展開して入力UIを表示。
                  return (
                    <div key={rule._key} className="rounded-lg border border-slate-300 bg-slate-50/40 p-3.5 ring-1 ring-slate-200">
                      {/* 名前 + 削除 */}
                      <div className="mb-3 flex items-center gap-2">
                        <input
                          type="text"
                          value={rule.name}
                          onChange={(e) => patchRule(rule._key, { name: e.target.value })}
                          placeholder="ルール名"
                          className="flex-1 rounded border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                        <button
                          type="button"
                          onClick={() => removeRule(rule._key)}
                          className="px-2 py-1 text-xs text-rose-600 hover:text-rose-800"
                        >
                          削除
                        </button>
                      </div>

                      {/* 提出期間（1期間=1行） */}
                      <div className="mb-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-700">提出期間</span>
                          <div className="flex items-center gap-1">
                            {PRESETS.map((p, i) => (
                              <button
                                key={p.label}
                                type="button"
                                onClick={() => applyPreset(rule._key, i)}
                                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          {rule.periods.map((p) => (
                            <div
                              key={p._key}
                              className="flex flex-wrap items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
                            >
                              <input
                                type="number"
                                min={1}
                                max={31}
                                value={p.startDay}
                                onChange={(e) => updatePeriod(rule, p._key, { startDay: Number(e.target.value) || 1 })}
                                className="w-12 rounded border border-slate-200 px-1.5 py-1 text-center"
                              />
                              <span className="text-slate-400">〜</span>
                              <input
                                type="number"
                                min={1}
                                max={31}
                                value={p.endDay}
                                onChange={(e) => updatePeriod(rule, p._key, { endDay: Number(e.target.value) || 1 })}
                                className="w-12 rounded border border-slate-200 px-1.5 py-1 text-center"
                              />
                              <span className="text-xs text-slate-500">日分</span>
                              <span className="mx-1 text-slate-300">｜</span>
                              <span className="text-xs text-slate-500">締切</span>
                              <CustomSelect
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
                                value={p.deadlineDay}
                                onChange={(e) => updatePeriod(rule, p._key, { deadlineDay: Number(e.target.value) || 1 })}
                                className="w-12 rounded border border-slate-200 px-1.5 py-1 text-center"
                              />
                              <span className="text-xs text-slate-500">日まで</span>
                              {rule.periods.length > 1 && (
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
                        <button
                          type="button"
                          onClick={() => addPeriod(rule)}
                          className="mt-1.5 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                        >
                          ＋ 期間を追加
                        </button>
                      </div>

                      {/* 期間例外（既定で折りたたみ） */}
                      <details className="mb-3 rounded-md border border-slate-200 bg-white [&_summary::-webkit-details-marker]:hidden" open={rule.overrides.length > 0}>
                        <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700">
                          <span>期間例外（GW等）{rule.overrides.length > 0 ? `・${rule.overrides.length}件` : ""}</span>
                          <span className="text-[11px] font-normal text-slate-400">開閉</span>
                        </summary>
                        <div className="border-t border-slate-100 p-3">
                          <div className="mb-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => addOverride(rule)}
                              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                            >
                              ＋ 例外
                            </button>
                          </div>
                          {rule.overrides.length === 0 ? (
                            <p className="text-[11px] text-slate-400">なし</p>
                          ) : (
                            <div className="space-y-1.5">
                              {rule.overrides.map((o) => (
                                <div key={o._key} className="flex flex-wrap items-center gap-1.5 text-sm">
                                  <MonthYearPicker
                                    value={{ year: o.targetYear, month: o.targetMonth }}
                                    onChange={(v) => updateOverride(rule, o._key, { targetYear: v.year, targetMonth: v.month })}
                                  />
                                  <CustomSelect
                                    value={String(o.periodSeq)}
                                    onChange={(v) => updateOverride(rule, o._key, { periodSeq: Number(v) })}
                                    options={rule.periods.map((p, i) => ({ value: String(i), label: `${p.startDay}〜${p.endDay}日` }))}
                                    clearable={false}
                                    size="sm"
                                    className="w-28"
                                  />
                                  <span className="text-xs text-slate-500">締切</span>
                                  <DatePicker
                                    value={ymdToDate(o.deadlineDate)}
                                    onChange={(d) => updateOverride(rule, o._key, { deadlineDate: dateToYmd(d) })}
                                    placeholder="締切日を選択"
                                    className="w-44"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeOverride(rule, o._key)}
                                    className="ml-auto px-1.5 py-1 text-xs text-rose-600 hover:text-rose-800"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </details>

                      {/* 対象ドライバー */}
                      <div className="rounded-md border border-slate-200 bg-white p-3">
                        <span className="text-xs font-semibold text-slate-700">
                          対象ドライバー（{rule.driverIds.length}人）
                        </span>
                        <p className="mb-2 mt-0.5 text-[11px] text-slate-400">名前をタップで割り当て（選択中は濃色）。1人は1ルールのみ。</p>
                        <div className="flex flex-wrap gap-1.5">
                          {drivers.map((d) => {
                            const on = rule.driverIds.includes(d.id);
                            return (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => toggleDriver(rule._key, d.id)}
                                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                  on
                                    ? "border-slate-800 bg-slate-800 text-white"
                                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                                }`}
                              >
                                {driverName(d)}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 編集を閉じる */}
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => toggleExpand(rule._key)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          編集を閉じる
                        </button>
                      </div>
                    </div>
                  );
                })}
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
