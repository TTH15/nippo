"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { Skeleton } from "@/lib/components/Skeleton";
import type {
  EventTeamRow,
  DriverRow,
  EventMemberRow,
  RankingResponse,
  ManualPointRow,
} from "./types";
import { applyPointDelta, medalForRank, tieRanks } from "./rankingUtils";

export function RankingTab({
  eventId,
  teams,
  members,
  drivers,
  hasPeriod,
  canWrite,
  onError,
  onConfirm,
}: {
  eventId: string;
  teams: EventTeamRow[];
  members: EventMemberRow[];
  drivers: DriverRow[];
  hasPeriod: boolean;
  canWrite: boolean;
  onError: (title: string, message: string) => void;
  onConfirm: (message: string, onOk: () => void) => void;
}) {
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [manual, setManual] = useState<ManualPointRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodError, setPeriodError] = useState(false);

  // 手動加点フォーム
  const [targetType, setTargetType] = useState<"driver" | "team">("driver");
  const [driverId, setDriverId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const memberDriverIds = useMemo(() => new Set(members.map((m) => m.driver_id)), [members]);
  const memberDrivers = useMemo(
    () => drivers.filter((d) => memberDriverIds.has(d.id)),
    [drivers, memberDriverIds],
  );

  // 同点は同順位で表示（並び自体は API 側で決定的に整列済み）
  const teamRanks = useMemo(() => tieRanks(ranking?.teams ?? []), [ranking]);
  const indivRanks = useMemo(() => tieRanks(ranking?.individuals ?? []), [ranking]);

  const nameOf = useCallback(
    (id: string) => {
      if (ranking?.driverNames[id]) return ranking.driverNames[id];
      const d = drivers.find((x) => x.id === id);
      return d ? getDisplayName(d) : id.slice(0, 6);
    },
    [ranking, drivers],
  );
  const teamName = useCallback(
    (id: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? "—" : "—"),
    [teams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setPeriodError(false);
    try {
      const [rk, mp] = await Promise.all([
        apiFetch<RankingResponse>(`/api/admin/events/${eventId}/ranking`).catch((e) => {
          if (e instanceof Error && e.message.includes("期間")) {
            setPeriodError(true);
            return null;
          }
          throw e;
        }),
        apiFetch<{ entries: ManualPointRow[] }>(`/api/admin/events/${eventId}/points`),
      ]);
      if (rk) setRanking(rk);
      setManual(mp.entries);
    } catch (e) {
      onError("読み込みに失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
    } finally {
      setLoading(false);
    }
  }, [eventId, onError]);

  // DB 書き込み後のバックグラウンド同期（ローディング表示なし）
  const silentSync = useCallback(async () => {
    try {
      const [rk, mp] = await Promise.all([
        apiFetch<RankingResponse>(`/api/admin/events/${eventId}/ranking`).catch(() => null),
        apiFetch<{ entries: ManualPointRow[] }>(`/api/admin/events/${eventId}/points`),
      ]);
      if (rk) setRanking(rk);
      setManual(mp.entries);
    } catch {
      // 楽観的更新済みなのでサイレントに無視
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const addManual = async () => {
    if (!canWrite || submitting) return;
    const pts = Number(points);
    if (!Number.isFinite(pts) || pts === 0) {
      onError("入力エラー", "ポイントは 0 以外の数値で入力してください。");
      return;
    }
    if (targetType === "driver" && !driverId) {
      onError("入力エラー", "対象ドライバーを選択してください。");
      return;
    }
    if (targetType === "team" && !teamId) {
      onError("入力エラー", "対象チームを選択してください。");
      return;
    }

    // フォーム値をキャプチャ
    const curType = targetType;
    const curDriverId = driverId;
    const curTeamId = teamId;
    const curPoints = pts;
    const curReason = reason.trim() || null;

    // 楽観的更新：即座に UI に反映
    const optimisticEntry: ManualPointRow = {
      id: `optimistic-${Date.now()}`,
      team_id: curType === "team" ? curTeamId : null,
      driver_id: curType === "driver" ? curDriverId : null,
      entry_date: null,
      points: curPoints,
      reason: curReason,
      source: "manual",
      created_at: new Date().toISOString(),
    };
    const prevManual = manual;
    const prevRanking = ranking;
    setManual((prev) => [...prev, optimisticEntry]);
    if (ranking) {
      setRanking(
        applyPointDelta(
          ranking,
          curType === "driver" ? curDriverId : null,
          curType === "team" ? curTeamId : null,
          curPoints,
        ),
      );
    }
    setPoints("");
    setReason("");
    setDriverId("");
    setTeamId("");

    // バックグラウンドで DB 書き込み
    setSubmitting(true);
    try {
      await apiFetch(`/api/admin/events/${eventId}/points`, {
        method: "POST",
        body: JSON.stringify({
          driverId: curType === "driver" ? curDriverId : null,
          teamId: curType === "team" ? curTeamId : null,
          points: curPoints,
          reason: curReason,
        }),
      });
      silentSync();
    } catch (e) {
      // ロールバック
      setManual(prevManual);
      setRanking(prevRanking);
      onError("加点に失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteManual = (entry: ManualPointRow) => {
    onConfirm("この手動加点を削除しますか？", async () => {
      // 楽観的削除
      const prevManual = manual;
      const prevRanking = ranking;
      setManual((prev) => prev.filter((e) => e.id !== entry.id));
      if (ranking) {
        setRanking(applyPointDelta(ranking, entry.driver_id, entry.team_id, -entry.points));
      }

      try {
        await apiFetch(`/api/admin/events/${eventId}/points/${entry.id}`, { method: "DELETE" });
        silentSync();
      } catch (e) {
        // ロールバック
        setManual(prevManual);
        setRanking(prevRanking);
        onError("削除に失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
      }
    });
  };

  if (!hasPeriod || periodError) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        ランキングを計算するには、「イベント設定」タブで<strong>開始日・終了日</strong>を設定してください。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "更新中..." : "再計算"}
        </button>
      </div>

      {loading && !ranking ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* チーム対抗 */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">チーム対抗</h3>
            <div className="space-y-2">
              {(ranking?.teams ?? []).length === 0 ? (
                <p className="text-sm text-slate-400">チームがありません。</p>
              ) : (
                ranking!.teams.map((t, i) => (
                  <div key={t.teamId} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-lg w-7 text-center">{medalForRank(teamRanks[i])}</span>
                        <span
                          className="inline-block h-3 w-3 rounded-full shrink-0"
                          style={{ background: t.color }}
                        />
                        <span className="font-semibold text-slate-800 truncate">{t.name}</span>
                      </div>
                      <span className="text-lg font-bold text-slate-900 tabular-nums">
                        {t.total} pt
                      </span>
                    </div>
                    <div className="mt-2 pl-9 space-y-0.5">
                      {t.members.map((m) => (
                        <div
                          key={m.driverId}
                          className="flex items-center justify-between text-xs text-slate-600"
                        >
                          <span>{nameOf(m.driverId)}</span>
                          <span className="tabular-nums">
                            {m.total} pt
                            {m.manualPoints !== 0 && (
                              <span className="text-slate-400">
                                {" "}
                                (手動 {m.manualPoints > 0 ? "+" : ""}
                                {m.manualPoints})
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                      {t.teamManualPoints !== 0 && (
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>チーム手動加点</span>
                          <span className="tabular-nums">
                            {t.teamManualPoints > 0 ? "+" : ""}
                            {t.teamManualPoints} pt
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 個人MVP */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">個人MVP</h3>
            <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
              {(ranking?.individuals ?? []).length === 0 ? (
                <p className="text-sm text-slate-400 p-3">対象ドライバーがいません。</p>
              ) : (
                ranking!.individuals.map((d, i) => (
                  <div key={d.driverId} className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-6 text-center text-sm">{medalForRank(indivRanks[i])}</span>
                      <span className="text-sm text-slate-800 truncate">{nameOf(d.driverId)}</span>
                      <span className="text-[11px] text-slate-400 shrink-0">
                        {teamName(d.teamId)}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {d.total} pt
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 手動加点 */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">手動で加点・減点</h3>
        {canWrite && (
          <div className="flex items-end gap-3 flex-wrap mb-4">
            <div className="w-28">
              <label className="block text-xs font-medium text-slate-600 mb-1">対象</label>
              <CustomSelect
                options={[
                  { value: "driver", label: "個人" },
                  { value: "team", label: "チーム" },
                ]}
                value={targetType}
                onChange={(v) => setTargetType(v as "driver" | "team")}
                clearable={false}
                size="sm"
              />
            </div>
            <div className="w-44">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {targetType === "driver" ? "ドライバー" : "チーム"}
              </label>
              {targetType === "driver" ? (
                <CustomSelect
                  options={memberDrivers.map((d) => ({ value: d.id, label: getDisplayName(d) }))}
                  value={driverId}
                  onChange={setDriverId}
                  placeholder="選択"
                  clearable={false}
                  size="sm"
                />
              ) : (
                <CustomSelect
                  options={teams.map((t) => ({ value: t.id, label: t.name }))}
                  value={teamId}
                  onChange={setTeamId}
                  placeholder="選択"
                  clearable={false}
                  size="sm"
                />
              )}
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-slate-600 mb-1">ポイント</label>
              <input
                type="number"
                step="any"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder="±"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
            <div className="flex-1 min-w-[10rem]">
              <label className="block text-xs font-medium text-slate-600 mb-1">理由（任意）</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例：MVP賞 / 遅刻ペナルティ"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
            <button
              type="button"
              onClick={addManual}
              disabled={submitting}
              className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50"
            >
              加点
            </button>
          </div>
        )}

        {manual.length === 0 ? (
          <p className="text-xs text-slate-400">手動加点はありません。</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {manual.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <span className="text-slate-700">
                    {e.driver_id ? nameOf(e.driver_id) : `${teamName(e.team_id)}（チーム）`}
                  </span>
                  {e.reason && <span className="text-slate-400 ml-2 text-xs">{e.reason}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`font-semibold tabular-nums ${
                      e.points >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {e.points > 0 ? "+" : ""}
                    {e.points} pt
                  </span>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => deleteManual(e)}
                      className="text-slate-400 hover:text-rose-600 text-xs"
                    >
                      削除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
