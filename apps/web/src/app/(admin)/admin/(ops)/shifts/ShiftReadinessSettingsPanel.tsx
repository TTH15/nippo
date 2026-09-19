"use client";

import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { ErrorDialog } from "@/lib/components/ErrorDialog";

// ============================================================
// 未解決一覧の「いつまでに直すか」と「何日先まで見るか」。
// 設計: docs/design/operational-risk-detection-2026-09.md O-1
//
// 種類ごとに9つ設定させない。手を打つ相手が同じものを3つにまとめる。
// 先読みが期限より短いと、期限が来る前に一覧へ出ない日ができるので保存時に弾く。
// ============================================================

export type ReadinessSettings = {
  staffingDueDays: number;
  confirmationDueDays: number;
  dispatchDueDays: number;
  horizonDays: number;
};

type Response = { settings: ReadinessSettings; defaults: ReadinessSettings };

const MAX_DUE_DAYS = 30;
const MAX_HORIZON_DAYS = 60;

const DUE_FIELDS: { key: keyof ReadinessSettings; label: string; detail: string }[] = [
  { key: "staffingDueDays", label: "人数・原本", detail: "人が足りない／休みの日に配置／人数未確定／原本と不一致" },
  { key: "confirmationDueDays", label: "本人の確認", detail: "本人未確認／対応不可／要再確認" },
  { key: "dispatchDueDays", label: "配車", detail: "車両が未割当" },
];

/** 先読みは一番長い期限以上でなければならない */
export function longestDueDays(settings: ReadinessSettings): number {
  return Math.max(settings.staffingDueDays, settings.confirmationDueDays, settings.dispatchDueDays);
}

export function isSameSettings(a: ReadinessSettings, b: ReadinessSettings): boolean {
  return (
    a.staffingDueDays === b.staffingDueDays &&
    a.confirmationDueDays === b.confirmationDueDays &&
    a.dispatchDueDays === b.dispatchDueDays &&
    a.horizonDays === b.horizonDays
  );
}

export default function ShiftReadinessSettingsPanel({
  canWrite,
  onDirtyChange,
  onClose,
}: {
  canWrite: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onClose?: () => void;
}) {
  const { data, refresh } = useApi<Response>("/api/admin/shifts/readiness-settings");
  const [draft, setDraft] = useState<ReadinessSettings | null>(null);
  const [saved, setSaved] = useState<ReadinessSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 入力中の生テキスト。"-" や空欄のあいだに数値へ丸めると、表示とモデルがずれる
  const [raw, setRaw] = useState<Partial<Record<keyof ReadinessSettings, string>>>({});

  useEffect(() => {
    if (!data?.settings) return;
    // 編集中に再検証が走っても、未保存の入力を黙って消さない。
    // 保存済みの基準だけ更新し、draft は本人の操作でしか変えない
    setSaved(data.settings);
    setDraft((current) => current ?? data.settings);
  }, [data]);

  const dirty = useMemo(() => !!draft && !!saved && !isSameSettings(draft, saved), [draft, saved]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  if (!draft || !saved) {
    return <p className="py-6 text-center text-xs text-slate-500">読み込み中…</p>;
  }

  const longest = longestDueDays(draft);
  const horizonTooShort = draft.horizonDays < longest;
  // 入力中（丸める前）は画面の数字と保存される値が違う。その間は保存させない
  const editing = Object.entries(raw).some(([key, text]) => {
    if (text == null) return false;
    if (text.trim() === "") return true;
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return true;
    const max = key === "horizonDays" ? MAX_HORIZON_DAYS : MAX_DUE_DAYS;
    const min = key === "horizonDays" ? 1 : 0;
    return parsed < min || parsed > max;
  });

  const save = async () => {
    if (!dirty || horizonTooShort || editing) return;
    setSaving(true);
    try {
      await apiFetch("/api/admin/shifts/readiness-settings", { method: "PUT", body: JSON.stringify(draft) });
      setSaved(draft);
      setRaw({});
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "期限の設定を保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const numberField = (
    key: keyof ReadinessSettings,
    max: number,
    suffix: string,
    label: string,
    describedBy?: string,
  ) => {
    const min = key === "horizonDays" ? 1 : 0;
    const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)));
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          // 閲覧のみでも値を読めるように、disabled ではなく readOnly にする
          // （disabled は Tab 順から外れ、読み上げでも到達できない）
          readOnly={!canWrite}
          aria-readonly={!canWrite}
          aria-label={`${label}（${suffix}）`}
          aria-describedby={describedBy}
          value={raw[key] ?? String(draft[key])}
          onChange={(event) => {
            const text = event.target.value;
            setRaw((prev) => ({ ...prev, [key]: text }));
            const parsed = Number(text);
            // 空欄・"-" だけの途中状態では確定させない
            if (text.trim() === "" || !Number.isFinite(parsed)) return;
            setDraft({ ...draft, [key]: clamp(parsed) });
          }}
          onBlur={() => {
            // 離れたときに丸めた値へ表示をそろえる
            setRaw((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
          }}
          className="h-11 w-16 rounded border border-slate-200 px-2 text-center text-sm tabular-nums read-only:bg-slate-50 read-only:text-slate-600"
        />
        <span className="text-xs text-slate-600">{suffix}</span>
      </div>
    );
  };

  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {DUE_FIELDS.map((field) => (
          <li key={field.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-slate-800">{field.label}</div>
              <div id={`readiness-due-${field.key}`} className="text-[11px] text-slate-500">{field.detail}</div>
            </div>
            {numberField(field.key, MAX_DUE_DAYS, "日前まで", field.label, `readiness-due-${field.key}`)}
          </li>
        ))}
        <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-slate-800">先読み</div>
            <div id="readiness-horizon" className="text-[11px] text-slate-500">この先の予定を見る範囲</div>
          </div>
          {numberField("horizonDays", MAX_HORIZON_DAYS, "日先まで", "先読み", "readiness-horizon")}
        </li>
      </ul>

      {horizonTooShort && (
        <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
          <FontAwesomeIcon icon={faTriangleExclamation} className="mr-1.5 h-3 w-3" />
          先読みを{longest}日先以上にしてください。期限が来る前に一覧へ出ない日ができます
        </p>
      )}

      <div className="mt-3 flex items-center justify-end gap-3">
        {canWrite && dirty && <span className="text-xs text-slate-500">未保存</span>}
        {onClose && (
          <button type="button" onClick={onClose} className="min-h-11 px-3 text-xs text-slate-600">
            閉じる
          </button>
        )}
        {canWrite && (
          <button
            type="button"
            disabled={saving || !dirty || horizonTooShort || editing}
            onClick={() => void save()}
            className="min-h-11 rounded-lg bg-slate-900 px-5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        )}
      </div>

      <ErrorDialog open={!!error} message={error ?? ""} onClose={() => setError(null)} />
    </div>
  );
}
