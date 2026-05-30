"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";
import { EventSettingsTab } from "./EventSettingsTab";
import { TeamsTab } from "./TeamsTab";
import { ScoringRuleTab } from "./ScoringRuleTab";
import { RankingTab } from "./RankingTab";
import type { EventListItem, EventDetailResponse } from "./types";
import { STATUS_LABEL } from "./types";

type Tab = "settings" | "teams" | "scoring" | "ranking";
const TABS: { key: Tab; label: string }[] = [
  { key: "settings", label: "イベント設定" },
  { key: "teams", label: "チーム編成" },
  { key: "scoring", label: "採点ルール" },
  { key: "ranking", label: "ランキング" },
];

export default function EventsPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDetailResponse | null>(null);
  const [tab, setTab] = useState<Tab>("settings");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(
    null,
  );
  const [errorState, setErrorState] = useState<{ title: string; message: string } | null>(null);

  const onError = useCallback((title: string, message: string) => {
    setErrorState({ title, message });
  }, []);
  const onConfirm = useCallback((message: string, onOk: () => void) => {
    setConfirmState({ message, onConfirm: onOk });
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const res = await apiFetch<{ events: EventListItem[] }>("/api/admin/events");
      setEvents(res.events);
      return res.events;
    } catch (e) {
      onError("読み込みに失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
      return [];
    } finally {
      setLoadingList(false);
    }
  }, [onError]);

  const loadDetail = useCallback(
    async (id: string, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoadingDetail(true);
      try {
        const res = await apiFetch<EventDetailResponse>(`/api/admin/events/${id}`);
        setDetail(res);
      } catch (e) {
        onError("読み込みに失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
      } finally {
        setLoadingDetail(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
    loadEvents();
  }, [loadEvents]);

  const selectEvent = (id: string) => {
    setSelectedId(id);
    setTab("settings");
    setDetail(null);
    loadDetail(id);
  };

  const createEvent = async () => {
    if (!canWrite || creating) return;
    if (!newName.trim()) {
      onError("入力エラー", "イベント名を入力してください。");
      return;
    }
    setCreating(true);
    try {
      const res = await apiFetch<{ event: EventListItem }>("/api/admin/events", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName("");
      await loadEvents();
      selectEvent(res.event.id);
    } catch (e) {
      onError("作成に失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
    } finally {
      setCreating(false);
    }
  };

  const reloadAll = useCallback(async () => {
    await loadEvents();
    if (selectedId) await loadDetail(selectedId, { silent: true });
  }, [loadEvents, loadDetail, selectedId]);

  const onEventDeleted = async () => {
    setSelectedId(null);
    setDetail(null);
    await loadEvents();
  };

  return (
    <AdminLayout>
      <div className="max-w-full">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">イベント（チーム戦）</h1>
          <p className="text-xs text-slate-500 mt-1">
            イベントの期間・チーム・採点ルールを設計し、承認済み日報の数量を集計して累計ポイントで競います。
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          {/* 左: イベント一覧 */}
          <div className="space-y-3">
            {canWrite && (
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createEvent()}
                  placeholder="新しいイベント名"
                  className="flex-1 min-w-0 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
                <button
                  type="button"
                  onClick={createEvent}
                  disabled={creating || !newName.trim()}
                  className="px-3 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50 shrink-0"
                >
                  作成
                </button>
              </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              {loadingList ? (
                <div className="p-3 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : events.length === 0 ? (
                <p className="p-4 text-sm text-slate-400">イベントがありません。</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {events.map((ev) => (
                    <li key={ev.id}>
                      <button
                        type="button"
                        onClick={() => selectEvent(ev.id)}
                        className={`w-full text-left px-3 py-2.5 transition-colors ${
                          selectedId === ev.id ? "bg-slate-100" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-800 truncate">{ev.name}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                              ev.status === "active"
                                ? "bg-emerald-100 text-emerald-700"
                                : ev.status === "closed"
                                  ? "bg-slate-200 text-slate-500"
                                  : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {STATUS_LABEL[ev.status]}
                          </span>
                        </div>
                        {(ev.starts_on || ev.ends_on) && (
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {ev.starts_on ?? "—"} 〜 {ev.ends_on ?? "—"}
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 右: 詳細 */}
          <div className="min-w-0">
            {!selectedId ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center text-sm text-slate-400">
                左の一覧からイベントを選択するか、新しいイベントを作成してください。
              </div>
            ) : loadingDetail || !detail ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <h2 className="text-lg font-bold text-slate-900">{detail.event.name}</h2>
                  <span className="text-xs text-slate-400">
                    {detail.event.starts_on ?? "期間未設定"}
                    {detail.event.starts_on || detail.event.ends_on
                      ? ` 〜 ${detail.event.ends_on ?? "—"}`
                      : ""}
                  </span>
                </div>

                <div className="flex gap-1 border-b border-slate-200 mb-5">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setTab(t.key)}
                      className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                        tab === t.key
                          ? "border-slate-800 text-slate-900"
                          : "border-transparent text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {tab === "settings" && (
                  <EventSettingsTab
                    event={detail.event}
                    canWrite={canWrite}
                    onSaved={reloadAll}
                    onDeleted={onEventDeleted}
                    onError={onError}
                    onConfirm={onConfirm}
                  />
                )}
                {tab === "teams" && (
                  <TeamsTab
                    eventId={detail.event.id}
                    teams={detail.teams}
                    members={detail.members}
                    drivers={detail.drivers}
                    canWrite={canWrite}
                    reload={() => loadDetail(detail.event.id, { silent: true })}
                    onMutate={(patch) => setDetail((d) => (d ? { ...d, ...patch } : d))}
                    onError={onError}
                    onConfirm={onConfirm}
                  />
                )}
                {tab === "scoring" && (
                  <ScoringRuleTab
                    eventId={detail.event.id}
                    scoringRule={detail.event.scoring_rule}
                    carriers={detail.carriers}
                    canWrite={canWrite}
                    onSaved={() => loadDetail(detail.event.id, { silent: true })}
                    onError={onError}
                  />
                )}
                {tab === "ranking" && (
                  <RankingTab
                    eventId={detail.event.id}
                    teams={detail.teams}
                    members={detail.members}
                    drivers={detail.drivers}
                    hasPeriod={Boolean(detail.event.starts_on && detail.event.ends_on)}
                    canWrite={canWrite}
                    onError={onError}
                    onConfirm={onConfirm}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message ?? ""}
        onConfirm={confirmState?.onConfirm ?? (() => {})}
        onClose={() => setConfirmState(null)}
        confirmLabel="OK"
      />
      <ErrorDialog
        open={!!errorState}
        title={errorState?.title}
        message={errorState?.message ?? ""}
        onClose={() => setErrorState(null)}
      />
    </AdminLayout>
  );
}
