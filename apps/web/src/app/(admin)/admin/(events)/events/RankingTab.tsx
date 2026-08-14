"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
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
  // SWR 化（2026-08 監査）: タブを離れて戻ってもキャッシュを即表示し、
  // イベント全期間の日報再集計（ranking API）を毎回走らせない。
  // 楽観更新はキャッシュ自体を書き換える（state 直接更新だと再検証で巻き戻る）。
  const rankingApi = useApi<RankingResponse>(`/api/admin/events/${eventId}/ranking`, {
    revalidateOnFocus: false,
    dedupingInterval: 60 * 1000,
  });
  const pointsApi = useApi<{ entries: ManualPointRow[] }>(`/api/admin/events/${eventId}/points`, {
    revalidateOnFocus: false,
  });
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [manual, setManual] = useState<ManualPointRow[]>([]);
  useEffect(() => {
    if (rankingApi.data) setRanking(rankingApi.data);
  }, [rankingApi.data]);
  useEffect(() => {
    if (pointsApi.data) setManual(pointsApi.data.entries ?? []);
  }, [pointsApi.data]);
  const loading = rankingApi.isInitialLoading || pointsApi.isInitialLoading;
  const periodError =
    rankingApi.error instanceof Error && rankingApi.error.message.includes("期間");

  // 手動加点フォーム
  const [targetType, setTargetType] = useState<"driver" | "team">("driver");
  const [driverId, setDriverId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 手動加点リストのチーム絞り込み
  const [filterTeamId, setFilterTeamId] = useState("");

  const memberDriverIds = useMemo(() => new Set(members.map((m) => m.driver_id)), [members]);
  const memberDrivers = useMemo(
    () => drivers.filter((d) => memberDriverIds.has(d.id)),
    [drivers, memberDriverIds],
  );

  // ドライバー → 所属チーム の対応表（個人加点をチームで絞り込むために使用）
  const driverTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.driver_id, m.team_id);
    return map;
  }, [members]);

  const filteredManual = useMemo(() => {
    if (!filterTeamId) return manual;
    return manual.filter((e) =>
      e.team_id ? e.team_id === filterTeamId : driverTeamMap.get(e.driver_id ?? "") === filterTeamId,
    );
  }, [manual, filterTeamId, driverTeamMap]);

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

  // 明示的な再計算（「再計算」ボタン）。通常の書き込み後は呼ばない。
  const load = useCallback(() => {
    void rankingApi.mutate();
    void pointsApi.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankingApi.mutate, pointsApi.mutate]);

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
    // 楽観更新は SWR キャッシュ側に適用する（state 直接更新だと再検証で巻き戻る）
    void pointsApi.mutate(
      (prev) => ({ entries: [...(prev?.entries ?? manual), optimisticEntry] }),
      { revalidate: false },
    );
    void rankingApi.mutate(
      (prev) =>
        prev
          ? applyPointDelta(
              prev,
              curType === "driver" ? curDriverId : null,
              curType === "team" ? curTeamId : null,
              curPoints,
            )
          : prev,
      { revalidate: false },
    );
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
      // points だけ確定（実IDに置換）。ranking は delta 適用済みのため、
      // イベント全期間の再集計は走らせない（旧 silentSync の廃止・2026-08 監査）
      void pointsApi.mutate();
    } catch (e) {
      // ロールバック（サーバー状態で取り直す）
      void pointsApi.mutate();
      void rankingApi.mutate();
      onError("加点に失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteManual = (entry: ManualPointRow) => {
    if (entry.id.startsWith("optimistic-")) {
      onError("削除に失敗しました", "反映中です。少し待ってからもう一度削除してください。");
      return;
    }
    const target = entry.driver_id ? nameOf(entry.driver_id) : `${teamName(entry.team_id)}（チーム）`;
    const sign = entry.points > 0 ? "+" : "";
    const detail = `${target} ${sign}${entry.points}pt${entry.reason ? `（${entry.reason}）` : ""}`;
    onConfirm(`この手動加点を削除しますか？\n\n${detail}`, async () => {
      // 楽観的削除（キャッシュ側に適用）
      void pointsApi.mutate(
        (prev) => ({ entries: (prev?.entries ?? manual).filter((e) => e.id !== entry.id) }),
        { revalidate: false },
      );
      void rankingApi.mutate(
        (prev) => (prev ? applyPointDelta(prev, entry.driver_id, entry.team_id, -entry.points) : prev),
        { revalidate: false },
      );

      try {
        await apiFetch(`/api/admin/events/${eventId}/points/${entry.id}`, { method: "DELETE" });
        // ranking は delta 適用済み。points だけ確定する
        void pointsApi.mutate();
      } catch (e) {
        // ロールバック（サーバー状態で取り直す）
        void pointsApi.mutate();
        void rankingApi.mutate();
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

        {manual.length > 0 && teams.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-medium text-slate-600">チーム絞り込み</span>
            <div className="w-44">
              <CustomSelect
                options={[
                  { value: "", label: "すべて" },
                  ...teams.map((t) => ({ value: t.id, label: t.name })),
                ]}
                value={filterTeamId}
                onChange={setFilterTeamId}
                clearable={false}
                size="sm"
              />
            </div>
          </div>
        )}

        {manual.length === 0 ? (
          <p className="text-xs text-slate-400">手動加点はありません。</p>
        ) : filteredManual.length === 0 ? (
          <p className="text-xs text-slate-400">該当する手動加点はありません。</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredManual.map((e) => (
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
