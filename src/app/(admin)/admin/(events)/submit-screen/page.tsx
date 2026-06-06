"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
type EventRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "closed";
  starts_on: string | null;
  ends_on: string | null;
  team_ranking_visible_to_drivers?: boolean;
};
type RankingSource = "auto" | "event" | "individual" | "none";
type Config = {
  metricLabel: string;
  metricFields: MetricField[];
  targetDriverIds: string[];
  period: string;
  rankingSource: RankingSource;
  linkedEventId: string | null;
  thanksTitle: string;
  thanksMessage: string;
  showRanking: boolean;
  teamRankingVisibleToDrivers: boolean;
};

const fkid = (unitId: string, fieldKey: string) => `${unitId}|${fieldKey}`;

const todayJstStr = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

const SOURCE_OPTIONS: { value: RankingSource; label: string; desc: string }[] = [
  { value: "auto", label: "自動", desc: "開催中イベントがあればそのチーム順位、なければ個人ランキング" },
  { value: "event", label: "イベント指定", desc: "選んだイベントのチーム順位を期間に関係なく表示" },
  { value: "individual", label: "個人ランキング", desc: "常に個人ランキングを表示" },
  { value: "none", label: "非表示", desc: "ランキングを表示しない" },
];

export default function SubmitScreenConfigPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [carriers, setCarriers] = useState<CarrierRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ config: Config; drivers: DriverRow[]; carriers: CarrierRow[]; events: EventRow[] }>(
        "/api/admin/submit-screen",
      );
      setCfg(res.config);
      setDrivers(res.drivers);
      setCarriers(res.carriers);
      setEvents(res.events ?? []);
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

  const today = todayJstStr();
  const activeEvent = useMemo(
    () =>
      events.find(
        (e) => e.status === "active" && e.starts_on && e.ends_on && e.starts_on <= today && e.ends_on >= today,
      ) ?? null,
    [events, today],
  );

  // 現在ドライバーに表示される内容（プレビュー）。サーバの分岐ロジックと対応させる。
  const targetEvent = useMemo(() => {
    if (!cfg) return null;
    if (cfg.rankingSource === "event") {
      const ev = events.find((e) => e.id === cfg.linkedEventId) ?? null;
      return ev && ev.starts_on && ev.ends_on ? ev : null; // 期間が無ければ個人へフォールバック
    }
    if (cfg.rankingSource === "auto") return activeEvent;
    return null;
  }, [cfg, events, activeEvent]);

  const setEventVisible = (id: string, visible: boolean) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, team_ranking_visible_to_drivers: visible } : e)));
  };

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
    if (cfg.rankingSource === "individual" && cfg.metricFields.length === 0) {
      setError({ title: "入力エラー", message: "個人ランキングを表示するには、集計する報告項目を1つ以上選択してください。" });
      return;
    }
    if (cfg.rankingSource === "event" && !cfg.linkedEventId) {
      setError({ title: "入力エラー", message: "「イベント指定」では連動するイベントを選択してください。" });
      return;
    }
    setSaving(true);
    try {
      // イベント毎の公開設定も同時保存（対象イベントのみ）。
      const eventVisibility = targetEvent
        ? [{ id: targetEvent.id, visible: targetEvent.team_ranking_visible_to_drivers === true }]
        : [];
      await apiFetch("/api/admin/submit-screen", {
        method: "PUT",
        body: JSON.stringify({ ...cfg, eventVisibility }),
      });
      await load();
    } catch (e) {
      setError({ title: "保存に失敗しました", message: e instanceof Error ? e.message : "もう一度お試しください。" });
    } finally {
      setSaving(false);
    }
  };

  const allSelected = cfg && drivers.length > 0 && cfg.targetDriverIds.length === drivers.length;
  // 個人ランキングの設定UIを出すか（auto は開催中が無ければ個人になるため常に出す）
  const showIndividualConfig = cfg ? cfg.rankingSource === "auto" || cfg.rankingSource === "individual" : false;
  // チーム（イベント）連動の設定UIを出すか
  const showEventConfig = cfg ? cfg.rankingSource === "auto" || cfg.rankingSource === "event" : false;

  const previewText = useMemo(() => {
    if (!cfg) return "";
    if (cfg.rankingSource === "none") return "ランキングは表示されません。";
    if (targetEvent) {
      const vis = targetEvent.team_ranking_visible_to_drivers === true;
      return `イベント「${targetEvent.name}」のチーム順位を表示${vis ? "（順位・他チーム・MVPも公開）" : "（自チームのポイントのみ）"}`;
    }
    if (cfg.rankingSource === "event") return "指定イベントが未選択／期間未設定のため、個人ランキングにフォールバックします。";
    if (cfg.rankingSource === "auto") return `開催中イベントが無いため、個人ランキング「${cfg.metricLabel}」を表示します。`;
    return `個人ランキング「${cfg.metricLabel}」を表示します。`;
  }, [cfg, targetEvent]);

  return (
    <AdminLayout>
      <div className="max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">送信後画面の設定</h1>
          <p className="text-xs text-slate-500 mt-1">
            ドライバーが日報を送信した後に出る画面（今日の報酬見込み・ランキング・メッセージ）を設定します。
          </p>
        </div>

        {loading || !cfg ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* 現在の表示プレビュー */}
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
              <div className="text-[11px] font-semibold text-sky-700 mb-1">今ドライバーに表示される内容</div>
              <div className="text-sm text-sky-900">{previewText}</div>
              {cfg.rankingSource === "auto" && (
                <div className="text-[11px] text-sky-600 mt-1.5">
                  {activeEvent ? `開催中: ${activeEvent.name}` : "現在、開催中（active・期間内）のイベントはありません。"}
                </div>
              )}
            </div>

            {/* 送信後メッセージ文言 */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-700">送信後メッセージ</div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">見出し</label>
                <input
                  value={cfg.thanksTitle}
                  onChange={(e) => setCfg({ ...cfg, thanksTitle: e.target.value })}
                  disabled={!canWrite}
                  placeholder="例：お疲れさまでした"
                  maxLength={100}
                  className="w-full max-w-sm px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">補足メッセージ（任意）</label>
                <textarea
                  value={cfg.thanksMessage}
                  onChange={(e) => setCfg({ ...cfg, thanksMessage: e.target.value })}
                  disabled={!canWrite}
                  placeholder="例：今日も一日ありがとうございました。安全運転で帰宅してください。"
                  maxLength={300}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
                />
              </div>
            </div>

            {/* ランキング表示ソース */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-700">ランキングの表示</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SOURCE_OPTIONS.map((opt) => {
                  const on = cfg.rankingSource === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={!canWrite}
                      onClick={() => setCfg({ ...cfg, rankingSource: opt.value })}
                      className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-50 ${on ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white hover:border-slate-300"}`}
                    >
                      <div className="text-sm font-semibold">{opt.label}</div>
                      <div className={`text-[11px] mt-0.5 ${on ? "text-slate-200" : "text-slate-500"}`}>{opt.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* イベント連動設定 */}
            {showEventConfig && (
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                <div className="text-sm font-semibold text-slate-700">イベント連動</div>

                {cfg.rankingSource === "event" && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">連動するイベント</label>
                    <select
                      value={cfg.linkedEventId ?? ""}
                      onChange={(e) => setCfg({ ...cfg, linkedEventId: e.target.value || null })}
                      disabled={!canWrite}
                      className="w-full max-w-md px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
                    >
                      <option value="">イベントを選択…</option>
                      {events.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name}
                          {ev.status === "active" ? "（開催中）" : ev.status === "closed" ? "（終了）" : "（下書き）"}
                          {ev.starts_on && ev.ends_on ? ` ${ev.starts_on}〜${ev.ends_on}` : "（期間未設定）"}
                        </option>
                      ))}
                    </select>
                    {events.length === 0 && (
                      <p className="text-[11px] text-amber-600 mt-1">イベントがありません。先に「イベント」でチーム戦を作成してください。</p>
                    )}
                  </div>
                )}

                {/* 対象イベントの順位公開設定（イベント毎） */}
                {targetEvent ? (
                  <label className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-700">
                        「{targetEvent.name}」で順位をドライバーに公開する
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        OFF の場合、ドライバーには自チームのポイントのみ表示し、順位・他チーム・個人MVPは見せません。
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={targetEvent.team_ranking_visible_to_drivers === true}
                      onClick={() => canWrite && setEventVisible(targetEvent.id, !(targetEvent.team_ranking_visible_to_drivers === true))}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${targetEvent.team_ranking_visible_to_drivers ? "bg-emerald-600" : "bg-slate-300"}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${targetEvent.team_ranking_visible_to_drivers ? "translate-x-5" : "translate-x-1"}`} />
                    </button>
                  </label>
                ) : cfg.rankingSource === "auto" ? (
                  <p className="text-[11px] text-slate-400">
                    開催中イベントが始まると、ここにそのイベントの順位公開設定が表示されます。
                  </p>
                ) : null}
              </div>
            )}

            {/* 個人ランキング設定 */}
            {showIndividualConfig && (
              <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                <div className="text-sm font-semibold text-slate-700">
                  個人ランキング
                  {cfg.rankingSource === "auto" && <span className="text-[11px] font-normal text-slate-400 ml-1">（開催中イベントが無いとき）</span>}
                </div>
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

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-slate-600">
                      対象ドライバー（{cfg.targetDriverIds.length === 0 ? "全員" : `${cfg.targetDriverIds.length}名`}）
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
              </div>
            )}

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
