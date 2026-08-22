"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faPenToSquare, faTrash, faTruck } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { hasCapability } from "@/lib/capabilities";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { Button } from "@/lib/ui/button";

type BillingType = "PER_PIECE" | "FIXED";
type InputType = "INT" | "TEXT" | "TIME" | "BOOL";

type Field = {
  id: string;
  unit_id: string;
  field_key: string;
  label: string;
  input_type: InputType;
  group_label: string | null;
  is_billable: boolean;
  required: boolean;
  sort_order: number;
};
type Unit = { id: string; carrier_id: string; name: string; code: string | null; billing_type: BillingType; sort_order: number; active: boolean; fields: Field[] };
type Carrier = { id: string; name: string; code: string | null; sort_order: number; active: boolean; units: Unit[] };

const INPUT_TYPE_LABEL: Record<InputType, string> = { INT: "数値", TEXT: "テキスト", TIME: "時刻", BOOL: "はい/いいえ" };

// 「何を報告させたいか」起点のプリセット
type Preset = { id: string; label: string; inputType: InputType; isBillable: boolean; desc: string };
const FIELD_PRESETS: Preset[] = [
  { id: "completed", label: "完了個数", inputType: "INT", isBillable: true, desc: "配達を完了した個数（売上・報酬の計算対象）" },
  { id: "returned", label: "持戻個数", inputType: "INT", isBillable: false, desc: "持ち戻った個数（記録のみ）" },
  { id: "mochidashi", label: "持出個数", inputType: "INT", isBillable: false, desc: "持ち出した個数（記録のみ）" },
  { id: "memo", label: "メモ", inputType: "TEXT", isBillable: false, desc: "自由記入の備考" },
  { id: "time", label: "時刻", inputType: "TIME", isBillable: false, desc: "開始/終了などの時刻" },
  { id: "flag", label: "チェック項目", inputType: "BOOL", isBillable: false, desc: "はい/いいえで答える項目" },
];

type FieldDraft = { label: string; inputType: InputType; groupLabel: string; isBillable: boolean; required: boolean };

export default function CarriersPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [errorState, setErrorState] = useState<{ message: string } | null>(null);

  // モーダル
  const [carrierModal, setCarrierModal] = useState<{ mode: "create" | "edit"; carrier?: Carrier } | null>(null);
  const [unitModal, setUnitModal] = useState<{ mode: "create" | "edit"; carrierId: string; unit?: Unit } | null>(null);
  const [fieldModal, setFieldModal] = useState<{ mode: "create" | "edit"; unitId: string; field?: Field; draft: FieldDraft } | null>(null);
  const [presetFor, setPresetFor] = useState<string | null>(null); // unitId

  useEffect(() => {
    setCanWrite(hasCapability("can_manage_carriers"));
  }, []);

  // SWR でキャッシュし、遷移をまたいで保持する（再訪時の点滅をなくす）。
  const {
    data: carriersData,
    error: carriersError,
    isInitialLoading,
    mutate: mutateCarriers,
  } = useApi<{ carriers: Carrier[] }>("/api/admin/carriers");
  const loading = isInitialLoading;

  useEffect(() => {
    if (!carriersData) return;
    const list = carriersData.carriers ?? [];
    setCarriers(list);
    setSelectedId((prev) => prev ?? list[0]?.id ?? null);
  }, [carriersData]);

  useEffect(() => {
    if (carriersError) {
      setErrorState({
        message: carriersError instanceof Error ? carriersError.message : "読み込みに失敗しました",
      });
    }
  }, [carriersError]);

  // 書き込み後の再取得（旧 load の代替）。
  const load = useCallback(() => mutateCarriers(), [mutateCarriers]);

  const fail = (e: unknown) => setErrorState({ message: e instanceof Error ? e.message : "操作に失敗しました" });
  const selected = useMemo(() => carriers.find((c) => c.id === selectedId) ?? null, [carriers, selectedId]);

  function askDelete(message: string, fn: () => Promise<void>) {
    setConfirmState({
      message,
      onConfirm: async () => {
        setConfirmState(null);
        // 削除自体の成否は await fn() で確定する。一覧の再取得は待たない。
        try { await fn(); void load(); } catch (e) { fail(e); }
      },
    });
  }

  // --- 保存系 ---
  // 編集（PATCH）はレスポンスの更新後行をキャッシュへ直接反映する
  // （1項目の変更でキャリア木まるごと再取得しない・2026-08 監査）。
  // 作成（POST）は新規行のツリー位置・採番があるため従来どおり再取得する。
  const applyCarrierPatch = (updated: Partial<Carrier> & { id: string }) => {
    void mutateCarriers(
      (prev) =>
        prev
          ? {
              carriers: prev.carriers.map((c) =>
                c.id === updated.id ? { ...c, ...updated, units: c.units } : c,
              ),
            }
          : prev,
      { revalidate: false },
    );
  };
  const applyUnitPatch = (updated: Partial<Unit> & { id: string }) => {
    void mutateCarriers(
      (prev) =>
        prev
          ? {
              carriers: prev.carriers.map((c) => ({
                ...c,
                units: c.units.map((u) =>
                  u.id === updated.id ? { ...u, ...updated, fields: u.fields } : u,
                ),
              })),
            }
          : prev,
      { revalidate: false },
    );
  };
  const applyFieldPatch = (updated: Partial<Field> & { id: string }) => {
    void mutateCarriers(
      (prev) =>
        prev
          ? {
              carriers: prev.carriers.map((c) => ({
                ...c,
                units: c.units.map((u) => ({
                  ...u,
                  fields: u.fields.map((f) => (f.id === updated.id ? { ...f, ...updated } : f)),
                })),
              })),
            }
          : prev,
      { revalidate: false },
    );
  };

  async function saveCarrier(name: string) {
    if (!carrierModal) return;
    try {
      if (carrierModal.mode === "create") {
        await apiFetch("/api/admin/carriers", { method: "POST", body: JSON.stringify({ name }) });
        void load();
      } else {
        const res = await apiFetch<{ carrier: Carrier }>(`/api/admin/carriers/${carrierModal.carrier!.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
        if (res?.carrier) applyCarrierPatch(res.carrier);
        else void load();
      }
      setCarrierModal(null);
    } catch (e) { fail(e); }
  }
  async function saveUnit(name: string, billingType: BillingType) {
    if (!unitModal) return;
    try {
      if (unitModal.mode === "create") {
        await apiFetch("/api/admin/units", { method: "POST", body: JSON.stringify({ carrier_id: unitModal.carrierId, name, billing_type: billingType }) });
        void load();
      } else {
        const res = await apiFetch<{ unit: Unit }>(`/api/admin/units/${unitModal.unit!.id}`, { method: "PATCH", body: JSON.stringify({ name, billing_type: billingType }) });
        if (res?.unit) applyUnitPatch(res.unit);
        else void load();
      }
      setUnitModal(null);
    } catch (e) { fail(e); }
  }
  async function saveField(d: FieldDraft) {
    if (!fieldModal) return;
    const body = { label: d.label, input_type: d.inputType, group_label: d.groupLabel || null, is_billable: d.isBillable, required: d.required };
    try {
      if (fieldModal.mode === "create") {
        await apiFetch("/api/admin/unit-fields", { method: "POST", body: JSON.stringify({ ...body, unit_id: fieldModal.unitId }) });
        void load();
      } else {
        const res = await apiFetch<{ field: Field }>(`/api/admin/unit-fields/${fieldModal.field!.id}`, { method: "PATCH", body: JSON.stringify(body) });
        if (res?.field) applyFieldPatch(res.field);
        else void load();
      }
      setFieldModal(null);
    } catch (e) { fail(e); }
  }

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-3">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <FontAwesomeIcon icon={faTruck} className="w-5 h-5 text-slate-400" />
            キャリア / 報告フォーム設計
          </h1>
          {canWrite && (
            <Button variant="default" size="default" onClick={() => setCarrierModal({ mode: "create" })}>
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              キャリアを追加
            </Button>
          )}
        </div>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4"><Skeleton className="h-64 w-full" /><div className="md:col-span-2"><Skeleton className="h-64 w-full" /></div></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 左: キャリア一覧 */}
            <div className="md:col-span-1">
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100 text-[11px] font-medium text-slate-500">キャリア</div>
                <ul>
                  {carriers.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelectedId(c.id)}
                        className={`w-full text-left px-3 py-2.5 flex items-center justify-between border-b border-slate-50 ${selectedId === c.id ? "bg-slate-900 text-white" : "hover:bg-slate-50 text-slate-800"}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-sm">{c.name}</span>
                          {!c.active && <span className={`text-[10px] ${selectedId === c.id ? "text-slate-300" : "text-slate-400"}`}>無効</span>}
                        </span>
                        <span className={`text-[10px] ${selectedId === c.id ? "text-slate-300" : "text-slate-400"}`}>{c.units.length}型</span>
                      </button>
                    </li>
                  ))}
                  {carriers.length === 0 && (
                    <li className="px-3 py-6 text-center text-xs text-slate-400">
                      キャリアがありません。右上の「キャリアを追加」から作成してください。
                    </li>
                  )}
                </ul>
              </div>
            </div>

            {/* 右: 選択キャリアの型＋報告フォーム設計 */}
            <div className="md:col-span-2">
              {!selected ? (
                <p className="text-sm text-slate-400 py-10 text-center">左からキャリアを選択してください。</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-900">{selected.name}</h2>
                    {canWrite && (
                      <div className="flex items-center gap-3 text-slate-400 text-sm">
                        <button title="キャリア名を編集" onClick={() => setCarrierModal({ mode: "edit", carrier: selected })} className="hover:text-slate-700"><FontAwesomeIcon icon={faPenToSquare} /></button>
                        <button title="キャリアを削除" onClick={() => askDelete(`キャリア「${selected.name}」を削除しますか？`, () => apiFetch(`/api/admin/carriers/${selected.id}`, { method: "DELETE" }))} className="hover:text-red-600"><FontAwesomeIcon icon={faTrash} /></button>
                      </div>
                    )}
                  </div>

                  {selected.units.length === 0 && <p className="text-xs text-slate-400">まだ型(unit)がありません。「型を追加」から作成してください。</p>}

                  {selected.units.map((u) => (
                    <div key={u.id} className="soft-rise rounded-lg border border-slate-200 bg-white">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{u.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">報告単位</span>
                        </div>
                        {canWrite && (
                          <div className="flex items-center gap-3 text-slate-400 text-xs">
                            <button title="型を編集" onClick={() => setUnitModal({ mode: "edit", carrierId: selected.id, unit: u })} className="hover:text-slate-700"><FontAwesomeIcon icon={faPenToSquare} /></button>
                            <button title="型を削除" onClick={() => askDelete(`型「${u.name}」を削除しますか？`, () => apiFetch(`/api/admin/units/${u.id}`, { method: "DELETE" }))} className="hover:text-red-600"><FontAwesomeIcon icon={faTrash} /></button>
                          </div>
                        )}
                      </div>

                      {/* ドライバーが見る報告フォームのプレビュー */}
                      <div className="px-4 py-3">
                        <div className="text-[11px] text-slate-400 mb-2">ドライバーの報告フォーム（プレビュー）</div>
                        {u.fields.length === 0 ? (
                          <p className="text-xs text-slate-400 mb-2">報告項目がありません。</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                            {u.fields.map((f) => (
                              <div
                                key={f.id}
                                onClick={canWrite ? () => setFieldModal({ mode: "edit", unitId: u.id, field: f, draft: { label: f.label, inputType: f.input_type, groupLabel: f.group_label ?? "", isBillable: f.is_billable, required: f.required } }) : undefined}
                                role={canWrite ? "button" : undefined}
                                className={`rounded-lg border border-slate-200 px-2.5 py-2 relative ${canWrite ? "cursor-pointer hover:border-slate-300 active:bg-slate-50" : ""}`}
                              >
                                <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1 pr-7">
                                  {f.group_label && <span className="text-[10px] px-1 rounded bg-amber-50 text-amber-600">{f.group_label}</span>}
                                  {f.label}{f.required && <span className="text-red-500">*</span>}
                                  {f.is_billable && <span className="text-[9px] px-1 rounded bg-emerald-50 text-emerald-600 ml-auto">課金</span>}
                                </div>
                                <div className="pointer-events-none">
                                  <PreviewInput type={f.input_type} />
                                </div>
                                {canWrite && (
                                  <button
                                    title="削除"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      askDelete(`項目「${f.label}」を削除しますか？`, () => apiFetch(`/api/admin/unit-fields/${f.id}`, { method: "DELETE" }));
                                    }}
                                    className="absolute top-1 right-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:text-red-600 hover:bg-red-50"
                                  >
                                    <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {canWrite && (
                          <button onClick={() => setPresetFor(u.id)} className="text-[11px] text-slate-600 hover:text-slate-900"><FontAwesomeIcon icon={faPlus} className="mr-1" />報告項目を追加</button>
                        )}
                      </div>
                    </div>
                  ))}

                  {canWrite && (
                    <button onClick={() => setUnitModal({ mode: "create", carrierId: selected.id })} className="w-full rounded-lg border border-dashed border-slate-300 py-3 text-sm text-slate-500 hover:bg-slate-50">
                      <FontAwesomeIcon icon={faPlus} className="mr-1" />型(unit)を追加
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* プリセット選択 */}
      {presetFor && (
        <PresetPicker
          onPick={(p) => {
            const unitId = presetFor;
            setPresetFor(null);
            setFieldModal({ mode: "create", unitId, draft: { label: p.label, inputType: p.inputType, groupLabel: "", isBillable: p.isBillable, required: false } });
          }}
          onCustom={() => {
            const unitId = presetFor;
            setPresetFor(null);
            setFieldModal({ mode: "create", unitId, draft: { label: "", inputType: "INT", groupLabel: "", isBillable: false, required: false } });
          }}
          onClose={() => setPresetFor(null)}
        />
      )}

      {carrierModal && <CarrierModal mode={carrierModal.mode} initial={carrierModal.carrier?.name ?? ""} onSave={saveCarrier} onClose={() => setCarrierModal(null)} />}
      {unitModal && <UnitModal mode={unitModal.mode} initialName={unitModal.unit?.name ?? ""} initialBilling={unitModal.unit?.billing_type ?? "PER_PIECE"} onSave={saveUnit} onClose={() => setUnitModal(null)} />}
      {fieldModal && <FieldModal mode={fieldModal.mode} initial={fieldModal.draft} onSave={saveField} onClose={() => setFieldModal(null)} />}

      <ConfirmDialog open={!!confirmState} message={confirmState?.message ?? ""} onConfirm={confirmState?.onConfirm ?? (() => {})} onClose={() => setConfirmState(null)} confirmLabel="削除" />
      <ErrorDialog open={!!errorState} message={errorState?.message ?? ""} onClose={() => setErrorState(null)} />
    </AdminLayout>
  );
}

function PreviewInput({ type }: { type: InputType }) {
  if (type === "BOOL") return <input type="checkbox" disabled className="opacity-60" />;
  return <input disabled placeholder={type === "TIME" ? "--:--" : type === "TEXT" ? "テキスト" : "0"} className="w-full px-2 py-1 border border-slate-200 rounded bg-slate-50 text-right text-sm text-slate-400" />;
}

function PresetPicker({ onPick, onCustom, onClose }: { onPick: (p: Preset) => void; onCustom: () => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="modal-panel-in bg-white rounded-lg shadow-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-2 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">何を報告させますか？</h2>
        </div>
        <div className="px-5 py-3 grid grid-cols-1 gap-1.5">
          {FIELD_PRESETS.map((p) => (
            <button key={p.id} onClick={() => onPick(p)} className="text-left rounded border border-slate-200 px-3 py-2 hover:bg-slate-50">
              <div className="text-sm text-slate-800 flex items-center gap-2">{p.label}
                <span className="text-[10px] px-1 rounded bg-slate-100 text-slate-500">{INPUT_TYPE_LABEL[p.inputType]}</span>
                {p.isBillable && <span className="text-[9px] px-1 rounded bg-emerald-50 text-emerald-600">課金対象</span>}
              </div>
              <div className="text-[11px] text-slate-400">{p.desc}</div>
            </button>
          ))}
          <button onClick={onCustom} className="text-left rounded border border-dashed border-slate-300 px-3 py-2 hover:bg-slate-50 text-sm text-slate-600">
            <FontAwesomeIcon icon={faPlus} className="mr-1" />カスタム（自由に作成）
          </button>
        </div>
        <div className="px-5 py-3 flex justify-end border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800">キャンセル</button>
        </div>
      </div>
    </div>
  );
}

function ModalShell({ title, children, onClose, onSave }: { title: string; children: React.ReactNode; onClose: () => void; onSave: () => void }) {
  return (
    <div className="modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="modal-panel-in bg-white rounded-lg shadow-lg w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 border-b border-slate-200"><h2 className="text-sm font-semibold text-slate-900">{title}</h2></div>
        <div className="px-5 py-4 space-y-3 text-sm">{children}</div>
        <div className="px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800">キャンセル</button>
          <button onClick={onSave} className="px-4 py-1.5 text-xs font-medium text-white bg-slate-900 rounded hover:bg-slate-700">保存</button>
        </div>
      </div>
    </div>
  );
}

function LabeledField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>{children}</div>;
}

function CarrierModal({ mode, initial, onSave, onClose }: { mode: "create" | "edit"; initial: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <ModalShell title={`キャリアを${mode === "create" ? "追加" : "編集"}`} onClose={onClose} onSave={() => onSave(name)}>
      <LabeledField label="キャリア名"><input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded" placeholder="例: ヤマト / Amazon / 郵便局" /></LabeledField>
    </ModalShell>
  );
}

function UnitModal({ mode, initialName, initialBilling, onSave, onClose }: { mode: "create" | "edit"; initialName: string; initialBilling: BillingType; onSave: (name: string, b: BillingType) => void; onClose: () => void }) {
  const [name, setName] = useState(initialName);
  return (
    <ModalShell title={`型(unit)を${mode === "create" ? "追加" : "編集"}`} onClose={onClose} onSave={() => onSave(name, initialBilling)}>
      <LabeledField label="型の名前（集計の単位）"><input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded" placeholder="例: 宅急便 / ネコポス / Amazon配送" /></LabeledField>
      <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        日当・歩合などの契約条件は、コースの「単価設定」で売上と支払を分けて設定します。
      </p>
    </ModalShell>
  );
}

function FieldModal({ mode, initial, onSave, onClose }: { mode: "create" | "edit"; initial: FieldDraft; onSave: (d: FieldDraft) => void; onClose: () => void }) {
  const [d, setD] = useState<FieldDraft>(initial);
  const set = (p: Partial<FieldDraft>) => setD((prev) => ({ ...prev, ...p }));
  return (
    <ModalShell title={`報告項目を${mode === "create" ? "追加" : "編集"}`} onClose={onClose} onSave={() => onSave(d)}>
      <LabeledField label="項目名（ドライバー画面の表示）"><input value={d.label} onChange={(e) => set({ label: e.target.value })} className="w-full px-2 py-1.5 border border-slate-300 rounded" placeholder="例: 完了個数" /></LabeledField>
      <LabeledField label="入力タイプ">
        <CustomSelect
          size="sm"
          clearable={false}
          value={d.inputType}
          onChange={(value) => set({ inputType: value as InputType })}
          options={(["INT", "TEXT", "TIME", "BOOL"] as InputType[]).map((t) => ({ value: t, label: INPUT_TYPE_LABEL[t] }))}
        />
      </LabeledField>
      <LabeledField label="グループ見出し（任意・例: 午前/午後）"><input value={d.groupLabel} onChange={(e) => set({ groupLabel: e.target.value })} className="w-full px-2 py-1.5 border border-slate-300 rounded" placeholder="空欄でOK" /></LabeledField>
      <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={d.isBillable} onChange={(e) => set({ isBillable: e.target.checked })} />この数を売上・報酬の計算に使う（課金数量）</label>
      <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={d.required} onChange={(e) => set({ required: e.target.checked })} />入力必須にする</label>
    </ModalShell>
  );
}
