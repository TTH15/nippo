"use client";

import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { Skeleton } from "@/lib/components/Skeleton";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { Button } from "@/lib/ui/button";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";

// ============================================================
// 自動配信の設定（notification-flow §3 モード1・2 / §5）。
// 既定は全て OFF。ここで有効にしたものだけが cron / イベントで自動送信される。
// ============================================================

type Settings = {
  assignmentEnabled: boolean;
  assignmentSendAt: string;
  assignmentIncludeMeeting: boolean;
  assignmentIncludeVehicle: boolean;
  restDayEnabled: boolean;
  changeEnabled: boolean;
  lineMonthlyLimit: number | null;
};

/** ON/OFF 行。説明を必ず添える（何が送られるのか分からないまま有効化させない）。 */
function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
  children,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-100 py-4 last:border-b-0">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-slate-800"
        />
        <span className="flex-1">
          <span className="block text-sm font-medium text-slate-800">{label}</span>
          <span className="mt-0.5 block text-sm text-slate-500">{description}</span>
        </span>
      </label>
      {checked && children && <div className="mt-3 pl-7">{children}</div>}
    </div>
  );
}

export function SettingsTab({ canWrite }: { canWrite: boolean }) {
  const { data, isInitialLoading, refresh } = useApi<{ settings: Settings }>(
    "/api/admin/notifications/settings",
    // フォーカス復帰の再検証で編集中のトグルが巻き戻らないようにする
    { revalidateOnFocus: false },
  );
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  // 未保存の編集がある間はサーバー値で上書きしない（dirty フラグ・2026-08 監査）
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (data?.settings && !dirtyRef.current) setSettings(data.settings);
  }, [data]);

  if (isInitialLoading || !settings) {
    return <Skeleton className="mt-4 h-64 w-full rounded-lg" />;
  }

  const update = (patch: Partial<Settings>) => {
    dirtyRef.current = true;
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setSavedAt(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/admin/notifications/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      dirtyRef.current = false; // 保存済み＝以降はサーバー値の同期を受け入れる
      setSavedAt(Date.now());
      void refresh(); // 保存は確定済み。再取得は待たない
    } catch (e) {
      setError({
        title: "保存に失敗しました",
        message: e instanceof Error ? e.message : "不明なエラーが発生しました",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-700">自動配信</h2>
        <p className="mt-1 text-sm text-slate-500">
          有効にした通知が、条件を満たしたときに自動で送られます。手動の一斉配信とは別枠です。
        </p>

        <div className="mt-2">
          <ToggleRow
            label="翌日のアサイン通知"
            description="翌日シフトが入っている人に、コース・集合・車両を前日に送ります。"
            checked={settings.assignmentEnabled}
            disabled={!canWrite}
            onChange={(v) => update({ assignmentEnabled: v })}
          >
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                送信時刻
                <input
                  type="time"
                  value={settings.assignmentSendAt}
                  disabled={!canWrite}
                  onChange={(e) => update({ assignmentSendAt: e.target.value })}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
                />
                <span className="text-xs text-slate-400">（前日・日本時間）</span>
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.assignmentIncludeMeeting}
                    disabled={!canWrite}
                    onChange={(e) => update({ assignmentIncludeMeeting: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 accent-slate-800"
                  />
                  集合場所・時刻を含める
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.assignmentIncludeVehicle}
                    disabled={!canWrite}
                    onChange={(e) => update({ assignmentIncludeVehicle: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 accent-slate-800"
                  />
                  車両ナンバーを含める
                </label>
              </div>
            </div>
          </ToggleRow>

          <ToggleRow
            label="休みの通知"
            description="翌日のシフトが入っていない人にも「明日は休みです」と送ります。"
            checked={settings.restDayEnabled}
            disabled={!canWrite}
            onChange={(v) => update({ restDayEnabled: v })}
          />

          <ToggleRow
            label="変更のお知らせ"
            description="通知を送ったあとに予定が変わったら、シフト管理の画面で知らせます。内容を確認して送信したときだけ届きます（自動では送りません）。"
            checked={settings.changeEnabled}
            disabled={!canWrite}
            onChange={(v) => update({ changeEnabled: v })}
          />
        </div>

        {settings.assignmentEnabled && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 shrink-0" />
            <span>
              シフトが未確定のまま送信時刻を迎えると、その時点の内容で送られます。
              確定を送信時刻より前に済ませてください。
            </span>
          </div>
        )}

        {/* org 別 LINE 上限（複数org運用の土台）。空欄=上限なし。 */}
        <div className="mt-6 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-medium text-slate-800">LINE 月間上限</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            この会社が今月LINEで送れる通数の上限です。空欄なら上限なし。
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="number"
              min={0}
              step={100}
              value={settings.lineMonthlyLimit ?? ""}
              disabled={!canWrite}
              onChange={(e) =>
                update({
                  lineMonthlyLimit: e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                })
              }
              placeholder="上限なし"
              className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
            />
            通 / 月
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          {savedAt && <span className="text-sm text-emerald-600">✓ 保存しました</span>}
          <Button size="touch" onClick={save} disabled={!canWrite || saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
        {!canWrite && (
          <p className="mt-2 text-sm text-slate-500">このロールには設定を変更する権限がありません。</p>
        )}
      </div>

      <ErrorDialog
        open={!!error}
        title={error?.title ?? ""}
        message={error?.message ?? ""}
        onClose={() => setError(null)}
      />
    </>
  );
}
