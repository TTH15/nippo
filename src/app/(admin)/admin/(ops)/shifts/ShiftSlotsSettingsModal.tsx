"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { CustomSelect } from "@/lib/components/CustomSelect";

// ============================================================
// 希望休の「便（時間帯）」設定モーダル。
//   キャリア別の便マスタ＋「便を使うドライバー」の割り当て（便ごとに対象者を選択）。
//   未割り当てのドライバーは全休のみ（便なし）。
// ============================================================

interface Props {
  open: boolean;
  canWrite: boolean;
  onClose: () => void;
  /** 親モーダル（タブ）に埋め込む場合はオーバーレイ/カードを描かない。 */
  embedded?: boolean;
}

type DriverInfo = { id: string; name: string; display_name: string | null };
type CarrierInfo = { id: string; name: string };
type SlotRow = { _key: string; id: string | null; carrierId: string; name: string; active: boolean; driverIds: string[] };
type SlotFull = { id: string; carrierId: string; name: string; sortOrder: number; active: boolean; driverIds: string[] };

const driverName = (d: DriverInfo) => d.display_name || d.name;
let keySeq = 0;
const nextKey = () => `s-${keySeq++}`;

export default function ShiftSlotsSettingsModal({ open, canWrite, onClose, embedded = false }: Props) {
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [carriers, setCarriers] = useState<CarrierInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open && !embedded) return;
    setError(null);
    setLoading(true);
    apiFetch<{ slots: SlotFull[]; drivers: DriverInfo[]; carriers: CarrierInfo[] }>("/api/admin/shift-slots")
      .then((res) => {
        setDrivers(res.drivers ?? []);
        setCarriers(res.carriers ?? []);
        setSlots(
          (res.slots ?? []).map((s) => ({
            _key: nextKey(),
            id: s.id,
            carrierId: s.carrierId,
            name: s.name,
            active: s.active,
            driverIds: s.driverIds ?? [],
          })),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [open, embedded]);

  if (!open && !embedded) return null;

  const patch = (key: string, p: Partial<SlotRow>) =>
    setSlots((prev) => prev.map((s) => (s._key === key ? { ...s, ...p } : s)));
  const addSlot = () =>
    setSlots((prev) => [
      ...prev,
      { _key: nextKey(), id: null, carrierId: carriers[0]?.id ?? "", name: "", active: true, driverIds: [] },
    ]);
  const removeSlot = (key: string) => setSlots((prev) => prev.filter((s) => s._key !== key));
  const toggleDriver = (key: string, driverId: string) =>
    setSlots((prev) =>
      prev.map((s) => {
        if (s._key !== key) return s;
        const has = s.driverIds.includes(driverId);
        return { ...s, driverIds: has ? s.driverIds.filter((d) => d !== driverId) : [...s.driverIds, driverId] };
      }),
    );

  const carrierName = (id: string) => carriers.find((c) => c.id === id)?.name ?? "—";
  const assignedSet = new Set(slots.flatMap((s) => s.driverIds));
  const unassigned = drivers.filter((d) => !assignedSet.has(d.id));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/api/admin/shift-slots", {
        method: "PUT",
        body: JSON.stringify({
          slots: slots
            .filter((s) => s.carrierId && s.name.trim())
            .map((s) => ({ id: s.id, carrierId: s.carrierId, name: s.name.trim(), active: s.active, driverIds: s.driverIds })),
        }),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={embedded ? "" : "fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"}>
      <div className={embedded ? "" : "bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto"}>
        <div className={embedded ? "" : "p-6"}>
          {!embedded && (
            <h2 className="text-lg font-semibold text-slate-900 mb-1">希望休の便（時間帯）設定</h2>
          )}
          <p className="text-xs text-slate-500 mb-4">
            キャリア別に便（午前便・午後便・4便など）を作り、便ごとに「使うドライバー」を割り当てます。
            どの便にも割り当てられていない人は、これまで通り「全休」だけを出せます（タップは増えません）。
          </p>

          {error && (
            <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
          )}

          {loading ? (
            <p className="text-sm text-slate-500 py-8 text-center">読み込み中…</p>
          ) : carriers.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">キャリアが未登録です。先にキャリアを作成してください。</p>
          ) : (
            <>
              <div className="space-y-4">
                {slots.map((slot) => (
                  <div key={slot._key} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <CustomSelect
                        disabled={!canWrite}
                        value={slot.carrierId}
                        onChange={(v) => patch(slot._key, { carrierId: v })}
                        options={carriers.map((c) => ({ value: c.id, label: c.name }))}
                        clearable={false}
                        size="sm"
                        className="w-32"
                      />
                      <input
                        type="text"
                        disabled={!canWrite}
                        value={slot.name}
                        onChange={(e) => patch(slot._key, { name: e.target.value })}
                        placeholder="便名（例: 午後便）"
                        className="flex-1 min-w-[8rem] px-3 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-50"
                      />
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          disabled={!canWrite}
                          checked={slot.active}
                          onChange={(e) => patch(slot._key, { active: e.target.checked })}
                        />
                        有効
                      </label>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => removeSlot(slot._key)}
                          className="px-2 py-1 text-xs text-rose-600 hover:text-rose-800"
                        >
                          削除
                        </button>
                      )}
                    </div>

                    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
                      <span className="text-xs font-semibold text-slate-700">
                        この便を使うドライバー（{slot.driverIds.length}人）
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5 mb-2">
                        名前をタップで割り当て（選択中は濃色）。{carrierName(slot.carrierId)}の便です。
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {drivers.map((d) => {
                          const on = slot.driverIds.includes(d.id);
                          return (
                            <button
                              key={d.id}
                              type="button"
                              disabled={!canWrite}
                              onClick={() => toggleDriver(slot._key, d.id)}
                              className={`px-2.5 py-1 text-xs rounded-full border transition-colors disabled:opacity-50 ${
                                on
                                  ? "bg-slate-800 border-slate-800 text-white"
                                  : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              {driverName(d)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {canWrite && (
                <button
                  type="button"
                  onClick={addSlot}
                  className="mt-3 px-3 py-1.5 text-xs font-medium rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                >
                  ＋ 便を追加
                </button>
              )}

              <div className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="text-sm font-medium text-slate-700 mb-1">便なし（全休のみ）: {unassigned.length}人</h3>
                {unassigned.length === 0 ? (
                  <p className="text-[11px] text-slate-400">全員いずれかの便を使います。</p>
                ) : (
                  <p className="text-xs text-slate-500">{unassigned.map(driverName).join("、")}</p>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">
              閉じる
            </button>
            {canWrite && (
              <button
                type="button"
                onClick={save}
                disabled={saving || loading}
                className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? "保存中…" : "保存"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
