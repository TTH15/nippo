"use client";

import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { CustomSelect } from "@/lib/components/CustomSelect";
import type { EventTeamRow, EventMemberRow, DriverRow } from "./types";

export function TeamsTab({
  eventId,
  teams,
  members,
  drivers,
  canWrite,
  reload,
  onError,
  onConfirm,
}: {
  eventId: string;
  teams: EventTeamRow[];
  members: EventMemberRow[];
  drivers: DriverRow[];
  canWrite: boolean;
  reload: () => void;
  onError: (title: string, message: string) => void;
  onConfirm: (message: string, onOk: () => void) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#3b82f6");
  const [busy, setBusy] = useState(false);

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

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teams) m.set(t.id, t.name);
    return m;
  }, [teams]);

  const membersOfTeam = (teamId: string) =>
    members
      .filter((m) => m.team_id === teamId)
      .map((m) => driverById.get(m.driver_id))
      .filter((d): d is DriverRow => Boolean(d))
      .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b), "ja"));

  const unassigned = drivers.filter((d) => !teamByDriver.has(d.id));

  const guard = async (fn: () => Promise<void>) => {
    if (!canWrite || busy) return;
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (e) {
      onError("操作に失敗しました", e instanceof Error ? e.message : "もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  const addTeam = () =>
    guard(async () => {
      if (!newName.trim()) {
        throw new Error("チーム名を入力してください");
      }
      await apiFetch(`/api/admin/events/${eventId}/teams`, {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      setNewName("");
    });

  const saveTeam = (teamId: string) =>
    guard(async () => {
      await apiFetch(`/api/admin/events/${eventId}/teams/${teamId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });
      setEditingId(null);
    });

  const deleteTeam = (team: EventTeamRow) => {
    onConfirm(`チーム「${team.name}」を削除しますか？所属メンバーの割当も外れます。`, () =>
      guard(async () => {
        await apiFetch(`/api/admin/events/${eventId}/teams/${team.id}`, { method: "DELETE" });
      }),
    );
  };

  const assign = (driverId: string, teamId: string) =>
    guard(async () => {
      await apiFetch(`/api/admin/events/${eventId}/members`, {
        method: "POST",
        body: JSON.stringify({ driverId, teamId }),
      });
    });

  const unassign = (driverId: string) =>
    guard(async () => {
      await apiFetch(`/api/admin/events/${eventId}/members`, {
        method: "DELETE",
        body: JSON.stringify({ driverId }),
      });
    });

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex items-end gap-3 flex-wrap">
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
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="h-9 w-10 rounded border border-slate-300 bg-white cursor-pointer"
            title="チームカラー"
          />
          <button
            type="button"
            onClick={addTeam}
            disabled={busy || !newName.trim()}
            className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50"
          >
            ＋ チーム追加
          </button>
        </div>
      )}

      {teams.length === 0 ? (
        <p className="text-sm text-slate-400">チームがありません。まずチームを追加してください。</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((team) => {
            const tm = membersOfTeam(team.id);
            const addable = drivers
              .filter((d) => teamByDriver.get(d.id) !== team.id)
              .map((d) => ({
                value: d.id,
                label: (() => {
                  const cur = teamByDriver.get(d.id);
                  const curName = cur ? teamNameById.get(cur) : null;
                  return curName ? `${getDisplayName(d)}（現: ${curName}）` : getDisplayName(d);
                })(),
              }));
            return (
              <div
                key={team.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
                style={{ boxShadow: `inset 4px 0 0 ${team.color}` }}
              >
                {editingId === team.id ? (
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-2 py-1 text-sm border border-slate-300 rounded"
                    />
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="h-8 w-9 rounded border border-slate-300 cursor-pointer"
                    />
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

                <div className="flex flex-wrap gap-1.5 mb-3 min-h-[1.5rem]">
                  {tm.length === 0 ? (
                    <span className="text-xs text-slate-400">メンバーなし</span>
                  ) : (
                    tm.map((d) => (
                      <span
                        key={d.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-xs"
                      >
                        {getDisplayName(d)}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => unassign(d.id)}
                            className="text-slate-400 hover:text-rose-600 leading-none"
                            title="外す"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))
                  )}
                </div>

                {canWrite && addable.length > 0 && (
                  <CustomSelect
                    options={addable}
                    value=""
                    onChange={(driverId) => driverId && assign(driverId, team.id)}
                    placeholder="＋ メンバーを追加 / 移動"
                    clearable={false}
                    size="sm"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
        <h4 className="text-sm font-medium text-slate-700 mb-2">
          未所属ドライバー（{unassigned.length}名）
        </h4>
        {unassigned.length === 0 ? (
          <p className="text-xs text-slate-400">全員いずれかのチームに所属しています。</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {unassigned
              .slice()
              .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b), "ja"))
              .map((d) => (
                <span
                  key={d.id}
                  className="px-2 py-0.5 bg-white border border-slate-200 text-slate-600 rounded-full text-xs"
                >
                  {getDisplayName(d)}
                </span>
              ))}
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-2">
          ※ 未所属ドライバーは採点・ランキングに含まれません。
        </p>
      </div>
    </div>
  );
}
