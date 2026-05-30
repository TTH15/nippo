"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ScoringRule, ScoringRuleSet } from "@/server/events/types";
import type { CarrierTreeRow } from "./types";

function fieldKeyId(unitId: string, fieldKey: string) {
  return `${unitId}|${fieldKey}`;
}

function newRuleId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `rule_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

export function ScoringRuleTab({
  eventId,
  scoringRule,
  carriers,
  canWrite,
  onSaved,
  onError,
}: {
  eventId: string;
  scoringRule: ScoringRuleSet;
  carriers: CarrierTreeRow[];
  canWrite: boolean;
  onSaved: () => void;
  onError: (title: string, message: string) => void;
}) {
  const [rules, setRules] = useState<ScoringRule[]>(scoringRule.rules);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRules(scoringRule.rules);
  }, [scoringRule]);

  // 全フィールドのラベル索引（表示用）
  const fieldLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of carriers) {
      for (const u of c.units) {
        for (const f of u.fields) {
          const g = f.group_label ? `${f.group_label} ` : "";
          m.set(fieldKeyId(u.id, f.field_key), `${c.name}・${g}${f.label}`);
        }
      }
    }
    return m;
  }, [carriers]);

  const dirty = useMemo(
    () => JSON.stringify(rules) !== JSON.stringify(scoringRule.rules),
    [rules, scoringRule.rules],
  );

  const updateRule = (id: string, patch: Partial<ScoringRule>) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const toggleField = (ruleId: string, unitId: string, fieldKey: string) =>
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== ruleId) return r;
        const exists = r.fields.some((f) => f.unitId === unitId && f.fieldKey === fieldKey);
        return {
          ...r,
          fields: exists
            ? r.fields.filter((f) => !(f.unitId === unitId && f.fieldKey === fieldKey))
            : [...r.fields, { unitId, fieldKey }],
        };
      }),
    );

  const addRule = () =>
    setRules((prev) => [...prev, { id: newRuleId(), label: "", fields: [], pointsPer: 1 }]);

  const removeRule = (id: string) => setRules((prev) => prev.filter((r) => r.id !== id));

  const save = async () => {
    if (!canWrite) return;
    for (const r of rules) {
      if (!r.label.trim()) {
        onError("入力エラー", "すべてのルールに名前を付けてください。");
        return;
      }
      if (r.fields.length === 0) {
        onError("入力エラー", `「${r.label}」の対象項目を1つ以上選択してください。`);
        return;
      }
    }
    setSaving(true);
    try {
      const payload: ScoringRuleSet = {
        version: 1,
        rules: rules.map((r) => ({ ...r, label: r.label.trim() })),
      };
      await apiFetch(`/api/admin/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify({ scoring_rule: payload }),
      });
      onSaved();
    } catch (e) {
      onError("保存に失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <p className="text-sm text-slate-500">
        「何にポイントを付けるか」を設計します。ルールごとに対象の報告項目（完了個数・持戻など）を選び、1数量あたりのポイントを設定します（マイナス可）。期間内の<strong>承認済み日報</strong>を集計してチーム・個人の累計ポイントになります。
      </p>

      {rules.length === 0 && (
        <p className="text-sm text-slate-400">ルールがありません。「ルールを追加」から作成してください。</p>
      )}

      <div className="space-y-4">
        {rules.map((rule) => (
          <div key={rule.id} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[12rem]">
                <label className="block text-xs font-medium text-slate-600 mb-1">ルール名</label>
                <input
                  value={rule.label}
                  onChange={(e) => updateRule(rule.id, { label: e.target.value })}
                  disabled={!canWrite}
                  placeholder="例：完了個数"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div className="w-32">
                <label className="block text-xs font-medium text-slate-600 mb-1">ポイント / 数量</label>
                <input
                  type="number"
                  step="any"
                  value={rule.pointsPer}
                  onChange={(e) => updateRule(rule.id, { pointsPer: Number(e.target.value) || 0 })}
                  disabled={!canWrite}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => removeRule(rule.id)}
                  className="px-3 py-2 text-sm text-rose-500 hover:text-rose-700"
                >
                  ルール削除
                </button>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-600">対象の報告項目</label>
                <span className="text-[11px] text-slate-400">{rule.fields.length}項目を選択中</span>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {carriers.map((c) => (
                  <div key={c.id} className="px-3 py-2">
                    <div className="text-xs font-semibold text-slate-700 mb-1">{c.name}</div>
                    {c.units.length === 0 ? (
                      <div className="text-[11px] text-slate-400">型・項目なし</div>
                    ) : (
                      c.units.map((u) => (
                        <div key={u.id} className="mb-1.5 last:mb-0">
                          {u.code && (
                            <div className="text-[11px] text-slate-400 mb-0.5">{u.code}</div>
                          )}
                          <div className="flex flex-wrap gap-1.5">
                            {u.fields.map((f) => {
                              const checked = rule.fields.some(
                                (rf) => rf.unitId === u.id && rf.fieldKey === f.field_key,
                              );
                              return (
                                <button
                                  key={f.id}
                                  type="button"
                                  disabled={!canWrite}
                                  onClick={() => toggleField(rule.id, u.id, f.field_key)}
                                  className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                                    checked
                                      ? "border-slate-700 bg-slate-800 text-white"
                                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                                  } disabled:opacity-50`}
                                >
                                  {f.group_label ? `${f.group_label} ` : ""}
                                  {f.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </div>
              {rule.fields.length > 0 && (
                <p className="text-[11px] text-slate-500 mt-1">
                  集計対象: {rule.fields.map((f) => fieldLabel.get(fieldKeyId(f.unitId, f.fieldKey)) ?? f.fieldKey).join(" ＋ ")}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {canWrite && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={addRule}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            ＋ ルールを追加
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="px-5 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50"
          >
            {saving ? "保存中..." : "採点ルールを保存"}
          </button>
        </div>
      )}
    </div>
  );
}
