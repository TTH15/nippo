"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faTrash,
  faUserShield,
  faLock,
  faChevronRight,
  faChevronDown,
  faGripVertical,
} from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { hasCapability } from "@/lib/capabilities";

// ============================================================
// ロール・権限管理（§2-6）。
// アコーディオンで各ロールを開き、権限はトグルで ON/OFF、メンバーは D&D（＋select 代替）で割当。
// ガバナンス保護: 管理者(ADMIN)は全権限固定（編集不可）・削除不可・最後の1人は外せない。
// ============================================================

type Role = {
  id: string;
  key: string;
  label: string;
  isSystem: boolean;
  sortOrder: number;
  worksAsDriver: boolean;
  capabilities: string[];
};
type Member = { id: string; name: string; roleId: string | null };
// サーバーの PERMISSION_ROWS と同形（server/auth/capabilities.ts が正本）
type PermissionRow =
  | { kind: "leveled"; key: string; label: string; description: string; view: string; manage: string }
  | { kind: "binary"; key: string; label: string; description: string; capability: string; onLabel: string };
type PermissionLevel = "none" | "view" | "edit" | "on";
type RolesRes = { roles: Role[]; members: Member[]; rows: PermissionRow[] };

const ADMIN_KEY = "ADMIN";
const DRIVER_KEY = "DRIVER";

export default function RolesPage() {
  const [canWrite, setCanWrite] = useState(false);
  useEffect(() => {
    setCanWrite(hasCapability("can_manage_members"));
  }, []);

  const { data, isLoading, mutate } = useSWR<RolesRes>(
    "/api/admin/roles",
    (url: string) => apiFetch<RolesRes>(url),
    { revalidateOnFocus: false },
  );
  const roles = data?.roles ?? [];
  const members = data?.members ?? [];
  const rows = data?.rows ?? [];

  const membersByRole = useMemo(() => {
    const m = new Map<string, Member[]>();
    for (const mem of members) {
      if (!mem.roleId) continue;
      m.set(mem.roleId, [...(m.get(mem.roleId) ?? []), mem]);
    }
    return m;
  }, [members]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [dragMember, setDragMember] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 行の現在レベルを capability 束から導出（manage > view > none。編集は閲覧を含む扱い）
  const rowLevel = (role: Role, row: PermissionRow): PermissionLevel => {
    if (role.isSystem && role.key === ADMIN_KEY) return row.kind === "leveled" ? "edit" : "on";
    if (row.kind === "leveled") {
      if (role.capabilities.includes(row.manage)) return "edit";
      if (role.capabilities.includes(row.view)) return "view";
      return "none";
    }
    return role.capabilities.includes(row.capability) ? "on" : "none";
  };

  // レベル選択（即座に色を反映し、保存はバックグラウンド。ADMIN は固定なので呼ばない）
  const setRowLevel = (role: Role, row: PermissionRow, level: PermissionLevel) => {
    if (role.isSystem && role.key === ADMIN_KEY) return;
    if (rowLevel(role, row) === level) return;
    const rowCaps = row.kind === "leveled" ? [row.view, row.manage] : [row.capability];
    const add =
      row.kind === "leveled"
        ? level === "edit"
          ? [row.view, row.manage]
          : level === "view"
            ? [row.view]
            : []
        : level === "on"
          ? [row.capability]
          : [];
    const nextCaps = [...role.capabilities.filter((c) => !rowCaps.includes(c)), ...add];

    // 楽観的更新: レスポンスを待たずに選択状態を切り替える
    void mutate(
      (prev) =>
        prev
          ? { ...prev, roles: prev.roles.map((r) => (r.id === role.id ? { ...r, capabilities: nextCaps } : r)) }
          : prev,
      { revalidate: false },
    );

    void apiFetch(`/api/admin/roles/${role.id}`, {
      method: "PATCH",
      body: JSON.stringify({ capabilities: nextCaps }),
    })
      .then(() => mutate())
      .catch((e) => {
        setError({ title: "更新に失敗", message: e instanceof Error ? e.message : "不明なエラー" });
        void mutate(); // 失敗時はサーバーの値に巻き戻す
      });
  };

  // 「ドライバーとして扱う」トグル。DRIVER ロールは常に ON（サーバー側でも固定）。
  const toggleWorksAsDriver = (role: Role) => {
    if (role.isSystem && role.key === DRIVER_KEY) return;
    const next = !role.worksAsDriver;

    void mutate(
      (prev) =>
        prev
          ? { ...prev, roles: prev.roles.map((r) => (r.id === role.id ? { ...r, worksAsDriver: next } : r)) }
          : prev,
      { revalidate: false },
    );

    void apiFetch(`/api/admin/roles/${role.id}`, {
      method: "PATCH",
      body: JSON.stringify({ worksAsDriver: next }),
    })
      .then(() => mutate())
      .catch((e) => {
        setError({ title: "更新に失敗", message: e instanceof Error ? e.message : "不明なエラー" });
        void mutate();
      });
  };

  const createRole = async () => {
    if (!newLabel.trim()) return;
    setBusy(true);
    try {
      await apiFetch("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify({ label: newLabel.trim(), capabilities: [] }),
      });
      setNewLabel("");
      setCreating(false);
      await mutate();
    } catch (e) {
      setError({ title: "作成に失敗", message: e instanceof Error ? e.message : "不明なエラー" });
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (r: Role) => {
    setConfirmDelete(null);
    try {
      await apiFetch(`/api/admin/roles/${r.id}`, { method: "DELETE" });
      await mutate();
    } catch (e) {
      setError({ title: "削除に失敗", message: e instanceof Error ? e.message : "不明なエラー" });
    }
  };

  // メンバーをロールへ割当（D&D / select 共通）。サーバーのガバナンス保護に当たれば 400 を表示。
  const assignMember = async (memberId: string, toRoleId: string) => {
    const mem = members.find((m) => m.id === memberId);
    if (!mem || mem.roleId === toRoleId) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/users/${memberId}`, {
        method: "PUT",
        body: JSON.stringify({ roleId: toRoleId }),
      });
      await mutate();
    } catch (e) {
      setError({ title: "割当に失敗", message: e instanceof Error ? e.message : "不明なエラー" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <FontAwesomeIcon icon={faUserShield} className="text-slate-400" />
            ロール・権限
          </h1>
          {canWrite && !creating && (
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              <FontAwesomeIcon icon={faPlus} />
              新規ロール
            </button>
          )}
        </div>

        <p className="mb-4 text-sm text-slate-500">
          ロールを開いて、機能ごとの許可レベルを選び、メンバーをドラッグ＆ドロップ（または選択）で割り当てます。
          <br />
          管理者はトップ権限のため、権限は全付与固定・削除不可・最後の1人は外せません。
        </p>

        {creating && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <input
              autoFocus
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && createRole()}
              placeholder="新しいロール名（例: 経理主任）"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
            <button
              onClick={createRole}
              disabled={busy || !newLabel.trim()}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              作成
            </button>
            <button
              onClick={() => {
                setCreating(false);
                setNewLabel("");
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600"
            >
              キャンセル
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {roles.map((r) => {
              const isAdmin = r.isSystem && r.key === ADMIN_KEY;
              const open = expanded.has(r.id);
              const roleMembers = membersByRole.get(r.id) ?? [];
              const others = members.filter((m) => m.roleId !== r.id);
              return (
                <div
                  key={r.id}
                  className={`rounded-lg border bg-white ${dropTarget === r.id ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200"}`}
                  onDragOver={(e) => {
                    if (dragMember) {
                      e.preventDefault();
                      setDropTarget(r.id);
                    }
                  }}
                  onDragLeave={() => dropTarget === r.id && setDropTarget(null)}
                  onDrop={() => {
                    if (dragMember) assignMember(dragMember, r.id);
                    setDragMember(null);
                    setDropTarget(null);
                  }}
                >
                  {/* ヘッダ */}
                  <div className="flex items-center gap-2 p-3">
                    <button onClick={() => toggleExpand(r.id)} className="flex flex-1 items-center gap-2 text-left">
                      <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} className="text-slate-400" />
                      <span className="font-semibold text-slate-900">{r.label}</span>
                      {isAdmin && (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                          <FontAwesomeIcon icon={faLock} className="text-[10px]" />
                          全権限固定
                        </span>
                      )}
                      {r.isSystem && !isAdmin && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">既定</span>
                      )}
                      {r.worksAsDriver && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">ドライバー稼働</span>
                      )}
                    </button>
                    {canWrite && !r.isSystem && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => setConfirmDelete(r)} className="rounded p-2 text-red-600 hover:bg-red-50" aria-label="削除">
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 展開エリア */}
                  {open && (
                    <div className="border-t border-slate-100 p-4">
                      {/* ドライバー稼働フラグ（役割=権限とは独立の軸。シフト・名簿への表示を決める） */}
                      {(() => {
                        const isDriverRole = r.isSystem && r.key === DRIVER_KEY;
                        const locked = !canWrite || isDriverRole;
                        return (
                          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
                            <div>
                              <div className="text-sm font-semibold text-slate-700">
                                ドライバーとして扱う
                                {isDriverRole && (
                                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
                                    <FontAwesomeIcon icon={faLock} className="text-[9px]" />
                                    固定
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-xs text-slate-500">
                                ON にすると、このロールのメンバーがシフト・勤怠・名簿に表示され、日報送信や希望休の提出ができます
                              </div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={r.worksAsDriver}
                              disabled={locked}
                              onClick={() => toggleWorksAsDriver(r)}
                              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                                r.worksAsDriver ? "bg-amber-500" : "bg-slate-300"
                              } ${locked ? "cursor-default opacity-70" : ""}`}
                            >
                              <span
                                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                                  r.worksAsDriver ? "left-[22px]" : "left-0.5"
                                }`}
                              />
                            </button>
                          </div>
                        );
                      })()}

                      {/* 権限（Discord 風: 機能ごとに 許可なし/閲覧のみ/編集可能 を選択） */}
                      <div className="mb-2 text-sm font-semibold text-slate-700">権限</div>
                      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                        {rows.map((row) => {
                          const level = rowLevel(r, row);
                          const options: { value: PermissionLevel; label: string }[] =
                            row.kind === "leveled"
                              ? [
                                  { value: "none", label: "許可なし" },
                                  { value: "view", label: "閲覧のみ" },
                                  { value: "edit", label: "編集可能" },
                                ]
                              : [
                                  { value: "none", label: "許可なし" },
                                  { value: "on", label: row.onLabel },
                                ];
                          return (
                            <div
                              key={row.key}
                              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-800">{row.label}</div>
                                <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{row.description}</div>
                              </div>
                              <div className="flex shrink-0 self-start rounded-lg bg-slate-100 p-0.5 sm:self-center">
                                {options.map((o) => {
                                  const selected = level === o.value;
                                  const selectedColor =
                                    o.value === "none" ? "text-rose-600" : o.value === "view" ? "text-slate-900" : "text-emerald-700";
                                  return (
                                    <button
                                      key={o.value}
                                      type="button"
                                      disabled={!canWrite || isAdmin}
                                      onClick={() => setRowLevel(r, row, o.value)}
                                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                                        selected
                                          ? `bg-white shadow-sm ${selectedColor}`
                                          : "text-slate-400 hover:text-slate-600"
                                      } ${!canWrite || isAdmin ? "cursor-default" : ""}`}
                                    >
                                      {o.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* メンバー割当 */}
                      <div className="mb-2 mt-5 text-sm font-semibold text-slate-700">
                        メンバー（{roleMembers.length}）
                      </div>
                      <div className="flex min-h-[2.5rem] flex-wrap gap-2 rounded-lg bg-slate-50 p-3">
                        {roleMembers.length === 0 && (
                          <span className="px-1 py-0.5 text-xs text-slate-400">
                            ここにメンバーをドラッグ、または下から選択
                          </span>
                        )}
                        {roleMembers.map((m) => (
                          <span
                            key={m.id}
                            draggable={canWrite}
                            onDragStart={() => setDragMember(m.id)}
                            onDragEnd={() => {
                              setDragMember(null);
                              setDropTarget(null);
                            }}
                            className={`inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-700 ${canWrite ? "cursor-grab active:cursor-grabbing" : ""}`}
                          >
                            {canWrite && <FontAwesomeIcon icon={faGripVertical} className="text-[10px] text-slate-300" />}
                            {m.name}
                          </span>
                        ))}
                      </div>
                      {canWrite && others.length > 0 && (
                        <div className="mt-2">
                          <select
                            value=""
                            onChange={(e) => e.target.value && assignMember(e.target.value, r.id)}
                            disabled={busy}
                            className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs text-slate-600"
                          >
                            <option value="">＋ 他のロールから追加…</option>
                            {others.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="ロールを削除"
        message={confirmDelete ? `「${confirmDelete.label}」を削除しますか？` : ""}
        confirmLabel="削除"
        onConfirm={() => confirmDelete && doDelete(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
      />
      <ErrorDialog open={!!error} title={error?.title} message={error?.message ?? ""} onClose={() => setError(null)} />
    </AdminLayout>
  );
}
