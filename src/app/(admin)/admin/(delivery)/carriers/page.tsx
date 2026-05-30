"use client";

import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faPenToSquare, faTrash } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";

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
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [errorState, setErrorState] = useState<{ message: string } | null>(null);

  // モーダル
  const [carrierModal, setCarrierModal] = useState<{ mode: "create" | "edit"; carrier?: Carrier } | null>(null);
  const [unitModal, setUnitModal] = useState<{ mode: "create" | "edit"; carrierId: string; unit?: Unit } | null>(null);
  const [fieldModal, setFieldModal] = useState<{ mode: "create" | "edit"; unitId: string; field?: Field; draft: FieldDraft } | null>(null);
  const [presetFor, setPresetFor] = useState<string | null>(null); // unitId

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch<{ carriers: Carrier[] }>("/api/admin/carriers");
      const list = res.carriers ?? [];
      setCarriers(list);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (e) {
      setErrorState({ message: e instanceof Error ? e.message : "読み込みに失敗しました" });
    } finally {
      setLoading(false);
    }
  }

  const fail = (e: unknown) => setErrorState({ message: e instanceof Error ? e.message : "操作に失敗しました" });
  const selected = useMemo(() => carriers.find((c) => c.id === selectedId) ?? null, [carriers, selectedId]);

  function askDelete(message: string, fn: () => Promise<void>) {
    setConfirmState({
      message,
      onConfirm: async () => {
        setConfirmState(null);
        try { await fn(); await load(); } catch (e) { fail(e); }
      },
    });
  }

  // --- 保存系 ---
  async function saveCarrier(name: string) {
    if (!carrierModal) return;
    try {
      if (carrierModal.mode === "create") await apiFetch("/api/admin/carriers", { method: "POST", body: JSON.stringify({ name }) });
      else await apiFetch(`/api/admin/carriers/${carrierModal.carrier!.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setCarrierModal(null); await load();
    } catch (e) { fail(e); }
  }
  async function saveUnit(name: string, billingType: BillingType) {
    if (!unitModal) return;
    try {
      if (unitModal.mode === "create") await apiFetch("/api/admin/units", { method: "POST", body: JSON.stringify({ carrier_id: unitModal.carrierId, name, billing_type: billingType }) });
      else await apiFetch(`/api/admin/units/${unitModal.unit!.id}`, { method: "PATCH", body: JSON.stringify({ name, billing_type: billingType }) });
      setUnitModal(null); await load();
    } catch (e) { fail(e); }
  }
  async function saveField(d: FieldDraft) {
    if (!fieldModal) return;
    const body = { label: d.label, input_type: d.inputType, group_label: d.groupLabel || null, is_billable: d.isBillable, required: d.required };
    try {
      if (fieldModal.mode === "create") await apiFetch("/api/admin/unit-fields", { method: "POST", body: JSON.stringify({ ...body, unit_id: fieldModal.unitId }) });
      else await apiFetch(`/api/admin/unit-fields/${fieldModal.field!.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setFieldModal(null); await load();
    } catch (e) { fail(e); }
  }

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-lg font-semibold text-slate-900 mb-1">キャリア / 報告フォーム設計</h1>
        <p className="text-xs text-slate-500 mb-5 leading-relaxed">
          ドライバーが日報で「何を報告するか」をここで設計します。<br />
          <b>キャリア</b>（ヤマト / Amazon など）の中に <b>型(unit)</b>（宅急便・ネコポス等の集計単位）を作り、
          その型ごとに <b>報告項目</b>（完了個数など）を並べます。料金（単価・日当）はコース側で設定します。
        </p>

        {loading ? (
          <div className="grid grid-cols-3 gap-4"><Skeleton className="h-64 w-full" /><div className="col-span-2"><Skeleton className="h-64 w-full" /></div></div>
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
                </ul>
                {canWrite && (
                  <button onClick={() => setCarrierModal({ mode: "create" })} className="w-full px-3 py-2.5 text-xs text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
                    <FontAwesomeIcon icon={faPlus} /> キャリアを追加
                  </button>
                )}
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
                    <div key={u.id} className="rounded-lg border border-slate-200 bg-white">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{u.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{u.billing_type === "FIXED" ? "固定(日当)" : "従量(個数×単価)"}</span>
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
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            {u.fields.map((f) => (
                              <div key={f.id} className="rounded border border-slate-200 px-2.5 py-2 group relative">
                                <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1">
                                  {f.group_label && <span className="text-[10px] px-1 rounded bg-indigo-50 text-indigo-600">{f.group_label}</span>}
                                  {f.label}{f.required && <span className="text-red-500">*</span>}
                                  {f.is_billable && <span className="text-[9px] px-1 rounded bg-emerald-50 text-emerald-600 ml-auto">課金</span>}
                                </div>
                                <PreviewInput type={f.input_type} />
                                {canWrite && (
                                  <div className="absolute top-1 right-1 hidden group-hover:flex items-center gap-2 bg-white/90 rounded px-1">
                                    <button title="編集" onClick={() => setFieldModal({ mode: "edit", unitId: u.id, field: f, draft: { label: f.label, inputType: f.input_type, groupLabel: f.group_label ?? "", isBillable: f.is_billable, required: f.required } })} className="text-slate-400 hover:text-slate-700 text-[11px]"><FontAwesomeIcon icon={faPenToSquare} /></button>
                                    <button title="削除" onClick={() => askDelete(`項目「${f.label}」を削除しますか？`, () => apiFetch(`/api/admin/unit-fields/${f.id}`, { method: "DELETE" }))} className="text-slate-400 hover:text-red-600 text-[11px]"><FontAwesomeIcon icon={faTrash} /></button>
                                  </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
        <div className="px-5 pt-5 pb-2 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">何を報告させますか？</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">よく使う項目から選ぶか、カスタムで自由に作成できます。</p>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
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
  const [billing, setBilling] = useState<BillingType>(initialBilling);
  return (
    <ModalShell title={`型(unit)を${mode === "create" ? "追加" : "編集"}`} onClose={onClose} onSave={() => onSave(name, billing)}>
      <LabeledField label="型の名前（集計の単位）"><input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded" placeholder="例: 宅急便 / ネコポス / Amazon配送" /></LabeledField>
      <LabeledField label="この型の課金の基本">
        <div className="space-y-1.5">
          <label className="flex items-start gap-2"><input type="radio" checked={billing === "PER_PIECE"} onChange={() => setBilling("PER_PIECE")} className="mt-0.5" /><span><b className="text-slate-700">従量</b><span className="text-[11px] text-slate-500"> — 個数 × 単価で計算（例: 完了個数）</span></span></label>
          <label className="flex items-start gap-2"><input type="radio" checked={billing === "FIXED"} onChange={() => setBilling("FIXED")} className="mt-0.5" /><span><b className="text-slate-700">固定</b><span className="text-[11px] text-slate-500"> — 1シフトいくらの日当（個数に依らない）</span></span></label>
        </div>
      </LabeledField>
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
        <select value={d.inputType} onChange={(e) => set({ inputType: e.target.value as InputType })} className="w-full px-2 py-1.5 border border-slate-300 rounded">
          {(["INT", "TEXT", "TIME", "BOOL"] as InputType[]).map((t) => <option key={t} value={t}>{INPUT_TYPE_LABEL[t]}</option>)}
        </select>
      </LabeledField>
      <LabeledField label="グループ見出し（任意・例: 午前/午後）"><input value={d.groupLabel} onChange={(e) => set({ groupLabel: e.target.value })} className="w-full px-2 py-1.5 border border-slate-300 rounded" placeholder="空欄でOK" /></LabeledField>
      <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={d.isBillable} onChange={(e) => set({ isBillable: e.target.checked })} />この数を売上・報酬の計算に使う（課金数量）</label>
      <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={d.required} onChange={(e) => set({ required: e.target.checked })} />入力必須にする</label>
    </ModalShell>
  );
}
