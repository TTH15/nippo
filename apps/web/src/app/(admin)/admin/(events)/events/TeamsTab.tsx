"use client";

import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import type { EventTeamRow, EventMemberRow, DriverRow } from "./types";

/** チームカラーのデフォルトパレット（この中から選択） */
const TEAM_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#22c55e",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#64748b",
];

function tempId() {
  return `tmp_${Math.random().toString(36).slice(2)}`;
}

function ColorPalette({
  value,
  onChange,
  size = "md",
}: {
  value: string;
  onChange: (c: string) => void;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  return (
    <div className="flex flex-wrap gap-1.5">
      {TEAM_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={c}
          className={`${dim} rounded-full border-2 transition-transform ${
            value.toLowerCase() === c.toLowerCase()
              ? "border-slate-900 scale-110"
              : "border-white shadow-[0_0_0_1px_rgba(0,0,0,0.1)] hover:scale-110"
          }`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

export function TeamsTab({
  eventId,
  teams,
  members,
  drivers,
  canWrite,
  reload,
  onMutate,
  onError,
  onConfirm,
}: {
  eventId: string;
  teams: EventTeamRow[];
  members: EventMemberRow[];
  drivers: DriverRow[];
  canWrite: boolean;
  reload: () => void;
  /** 楽観的更新: 親の detail(teams/members) を即時パッチ */
  onMutate: (patch: { teams?: EventTeamRow[]; members?: EventMemberRow[] }) => void;
  onError: (title: string, message: string) => void;
  onConfirm: (message: string, onOk: () => void) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TEAM_COLORS[7]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(TEAM_COLORS[7]);
  const [dragDriverId, setDragDriverId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null); // teamId or "unassigned"
  const [pickFor, setPickFor] = useState<DriverRow | null>(null); // タップ割当の対象ドライバー

  const teamByDriver = useMemo(() => {
    const m = new Map<string, string>();
    for (const mem of members) m.set(mem.driver_id, mem.team_id);
    return m;
  }, [members]);

  const driverById = useMemo(() => {
    const m = new Map<string, DriverRow>();
    for (const d of drivers) m.set(d.id, d);
    return m;
  }, [drivers]);

  const membersOfTeam = (teamId: string) =>
    members
      .filter((m) => m.team_id === teamId)
      .map((m) => driverById.get(m.driver_id))
      .filter((d): d is DriverRow => Boolean(d))
      .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b), "ja"));

  const unassigned = drivers
    .filter((d) => !teamByDriver.has(d.id))
    .slice()
    .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b), "ja"));

  /** 楽観的更新＋裏でDB保存。失敗時は reload で巻き戻し */
  const optimistic = async (patch: { teams?: EventTeamRow[]; members?: EventMemberRow[] }, save: () => Promise<void>) => {
    if (!canWrite) return;
    onMutate(patch);
    try {
      await save();
    } catch (e) {
      onError("操作に失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
      reload();
    }
  };

  const addTeam = async () => {
    if (!canWrite || !newName.trim()) return;
    const name = newName.trim();
    const color = newColor;
    setNewName("");
    try {
      const res = await apiFetch<{ team: EventTeamRow }>(`/api/admin/events/${eventId}/teams`, {
        method: "POST",
        body: JSON.stringify({ name, color }),
      });
      onMutate({ teams: [...teams, res.team] });
    } catch (e) {
      onError("作成に失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
    }
  };

  const saveTeam = (teamId: string) => {
    const name = editName.trim();
    if (!name) return;
    const color = editColor;
    setEditingId(null);
    void optimistic(
      { teams: teams.map((t) => (t.id === teamId ? { ...t, name, color } : t)) },
      () =>
        apiFetch(`/api/admin/events/${eventId}/teams/${teamId}`, {
          method: "PATCH",
          body: JSON.stringify({ name, color }),
        }).then(() => undefined),
    );
  };

  const deleteTeam = (team: EventTeamRow) => {
    onConfirm(`チーム「${team.name}」を削除しますか？所属メンバーの割当も外れます。`, () =>
      optimistic(
        {
          teams: teams.filter((t) => t.id !== team.id),
          members: members.filter((m) => m.team_id !== team.id),
        },
        () =>
          apiFetch(`/api/admin/events/${eventId}/teams/${team.id}`, { method: "DELETE" }).then(
            () => undefined,
          ),
      ),
    );
  };

  const assign = (driverId: string, teamId: string) => {
    if (teamByDriver.get(driverId) === teamId) return;
    const nextMembers: EventMemberRow[] = [
      ...members.filter((m) => m.driver_id !== driverId),
      { id: tempId(), team_id: teamId, driver_id: driverId },
    ];
    void optimistic({ members: nextMembers }, () =>
      apiFetch(`/api/admin/events/${eventId}/members`, {
        method: "POST",
        body: JSON.stringify({ driverId, teamId }),
      }).then(() => undefined),
    );
  };

  const unassign = (driverId: string) => {
    void optimistic({ members: members.filter((m) => m.driver_id !== driverId) }, () =>
      apiFetch(`/api/admin/events/${eventId}/members`, {
        method: "DELETE",
        body: JSON.stringify({ driverId }),
      }).then(() => undefined),
    );
  };

  // --- ドラッグ&ドロップ ---
  const dragProps = (driverId: string) =>
    canWrite
      ? {
          draggable: true,
          onDragStart: () => setDragDriverId(driverId),
          onDragEnd: () => {
            setDragDriverId(null);
            setDragOver(null);
          },
        }
      : {};
  const dropProps = (target: string, onDrop: () => void) =>
    canWrite
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            if (dragOver !== target) setDragOver(target);
          },
          onDragLeave: () => setDragOver((p) => (p === target ? null : p)),
          onDrop: () => {
            if (dragDriverId) onDrop();
            setDragDriverId(null);
            setDragOver(null);
          },
        }
      : {};

  // タップで「チーム選択」オーバーレイを開く（ドラッグはデスクトップ向けに併存）。
  const driverChip = (d: DriverRow, opts?: { onRemove?: () => void }) => (
    <span
      key={d.id}
      {...dragProps(d.id)}
      onClick={canWrite ? () => setPickFor(d) : undefined}
      title={canWrite ? "タップでチームを選択" : undefined}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs select-none ${
        canWrite ? "cursor-pointer active:bg-slate-200" : ""
      } ${opts?.onRemove ? "bg-slate-100 text-slate-700" : "bg-white border border-slate-200 text-slate-600"}`}
    >
      {getDisplayName(d)}
      {canWrite && opts?.onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            opts.onRemove?.();
          }}
          className="-mr-1 flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:text-rose-600 hover:bg-white leading-none"
          title="外す"
        >
          ×
        </button>
      )}
    </span>
  );

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex items-end gap-3 flex-wrap rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">新しいチーム</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTeam()}
              placeholder="チーム名"
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">カラー</label>
            <ColorPalette value={newColor} onChange={setNewColor} />
          </div>
          <button
            type="button"
            onClick={addTeam}
            disabled={!newName.trim()}
            className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50"
          >
            ＋ チーム追加
          </button>
        </div>
      )}

      {canWrite && (
        <p className="text-xs text-slate-400 -mt-2">
          ※ ドライバーのチップをドラッグして、チームや「未所属」へドロップで移動できます。
        </p>
      )}

      {teams.length === 0 ? (
        <p className="text-sm text-slate-400">チームがありません。まずチームを追加してください。</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((team) => {
            const tm = membersOfTeam(team.id);
            const isOver = dragOver === team.id;
            return (
              <div
                key={team.id}
                {...dropProps(team.id, () => dragDriverId && assign(dragDriverId, team.id))}
                className={`rounded-lg border bg-white p-4 transition-colors ${
                  isOver ? "border-slate-400 ring-2 ring-slate-200" : "border-slate-200"
                }`}
                style={{ boxShadow: `inset 4px 0 0 ${team.color}` }}
              >
                {editingId === team.id ? (
                  <div className="space-y-2 mb-3">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-slate-300 rounded"
                    />
                    <ColorPalette value={editColor} onChange={setEditColor} size="sm" />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveTeam(team.id)}
                        className="px-2 py-1 text-xs bg-slate-800 text-white rounded"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2 py-1 text-xs text-slate-500"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0"
                        style={{ background: team.color }}
                      />
                      <span className="font-semibold text-slate-800 truncate">{team.name}</span>
                      <span className="text-xs text-slate-400">{tm.length}名</span>
                    </div>
                    {canWrite && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(team.id);
                            setEditName(team.name);
                            setEditColor(team.color);
                          }}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTeam(team)}
                          className="text-xs text-rose-500 hover:text-rose-700"
                        >
                          削除
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className={`flex flex-wrap gap-1.5 min-h-[2.25rem] rounded-md p-1 ${isOver ? "bg-slate-50" : ""}`}>
                  {tm.length === 0 ? (
                    <span className="text-xs text-slate-400 self-center px-1">
                      {canWrite ? "ここにドライバーをドロップ" : "メンバーなし"}
                    </span>
                  ) : (
                    tm.map((d) => driverChip(d, { onRemove: () => unassign(d.id) }))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        {...dropProps("unassigned", () => dragDriverId && unassign(dragDriverId))}
        className={`rounded-lg border bg-slate-50/60 p-4 transition-colors ${
          dragOver === "unassigned" ? "border-slate-400 ring-2 ring-slate-200" : "border-slate-200"
        }`}
      >
        <h4 className="text-sm font-medium text-slate-700 mb-2">未所属ドライバー（{unassigned.length}名）</h4>
        {unassigned.length === 0 ? (
          <p className="text-xs text-slate-400">全員いずれかのチームに所属しています。</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">{unassigned.map((d) => driverChip(d))}</div>
        )}
        <p className="text-[11px] text-slate-400 mt-2">
          ※ 未所属ドライバーは採点・ランキングに含まれません。ドライバーをタップしてチームを選べます。
        </p>
      </div>

      {/* タップ割当: ドライバーをタップ→チーム選択（ドラッグできない端末向け） */}
      {pickFor && (
        <div
          className="modal-backdrop-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setPickFor(null)}
        >
          <div className="modal-panel-in w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-sm font-semibold text-slate-800">「{getDisplayName(pickFor)}」をチームへ</div>
            <div className="space-y-1.5">
              {teams.map((t) => {
                const current = teamByDriver.get(pickFor.id) === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      assign(pickFor.id, t.id);
                      setPickFor(null);
                    }}
                    className={`flex w-full items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm ${current ? "border-slate-800 bg-slate-50" : "border-slate-200 hover:bg-slate-50"}`}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
                    <span className="font-medium text-slate-800">{t.name}</span>
                    {current && <span className="ml-auto text-[11px] text-slate-500">現在</span>}
                  </button>
                );
              })}
              {teamByDriver.get(pickFor.id) && (
                <button
                  type="button"
                  onClick={() => {
                    unassign(pickFor.id);
                    setPickFor(null);
                  }}
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-left text-sm text-slate-500 hover:bg-slate-50"
                >
                  未所属に戻す
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPickFor(null)}
              className="mt-3 w-full rounded-xl bg-slate-100 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
