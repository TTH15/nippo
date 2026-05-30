"use client";

import { useEffect, useState } from "react";
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
type Unit = {
  id: string;
  carrier_id: string;
  name: string;
  code: string | null;
  billing_type: BillingType;
  sort_order: number;
  active: boolean;
  fields: Field[];
};
type Carrier = {
  id: string;
  name: string;
  code: string | null;
  sort_order: number;
  active: boolean;
  units: Unit[];
};

type ModalState =
  | { kind: "carrier"; mode: "create" | "edit"; carrier?: Carrier }
  | { kind: "unit"; mode: "create" | "edit"; carrierId: string; unit?: Unit }
  | { kind: "field"; mode: "create" | "edit"; unitId: string; field?: Field };

const INPUT_TYPE_LABEL: Record<InputType, string> = {
  INT: "整数",
  TEXT: "テキスト",
  TIME: "時刻",
  BOOL: "真偽",
};

export default function CarriersPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [errorState, setErrorState] = useState<{ title?: string; message: string } | null>(null);

  useEffect(() => {
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch<{ carriers: Carrier[] }>("/api/admin/carriers");
      setCarriers(res.carriers ?? []);
    } catch (e) {
      setErrorState({ message: e instanceof Error ? e.message : "読み込みに失敗しました" });
    } finally {
      setLoading(false);
    }
  }

  function fail(e: unknown) {
    setErrorState({ message: e instanceof Error ? e.message : "操作に失敗しました" });
  }

  // ---- 削除 ----
  function askDelete(message: string, fn: () => Promise<void>) {
    setConfirmState({
      message,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await fn();
          await load();
        } catch (e) {
          fail(e);
        }
      },
    });
  }

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-lg font-semibold text-slate-900">キャリア / 型(unit) 設定</h1>
          {canWrite && (
            <button
              type="button"
              onClick={() => setModal({ kind: "carrier", mode: "create" })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded hover:bg-slate-700 transition-colors"
            >
              <FontAwesomeIcon icon={faPlus} /> キャリア追加
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-5">
          キャリア（ヤマト / Amazon / 郵便局 など）と、その中の型(unit)・ドライバーの報告項目を設定します。
          課金（単価・日当）はコース側で設定します。
        </p>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : carriers.length === 0 ? (
          <p className="text-sm text-slate-500">キャリアがまだありません。</p>
        ) : (
          <div className="space-y-4">
            {carriers.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 bg-white">
                {/* carrier header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{c.name}</span>
                    {c.code && <span className="text-[11px] font-mono text-slate-400">{c.code}</span>}
                    {!c.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">無効</span>}
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-3 text-slate-400">
                      <button title="編集" onClick={() => setModal({ kind: "carrier", mode: "edit", carrier: c })} className="hover:text-slate-700">
                        <FontAwesomeIcon icon={faPenToSquare} />
                      </button>
                      <button title="削除" onClick={() => askDelete(`キャリア「${c.name}」を削除しますか？`, () => apiFetch(`/api/admin/carriers/${c.id}`, { method: "DELETE" }))} className="hover:text-red-600">
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  )}
                </div>

                {/* units */}
                <div className="px-4 py-3 space-y-3">
                  {c.units.length === 0 && <p className="text-xs text-slate-400">型(unit)がありません。</p>}
                  {c.units.map((u) => (
                    <div key={u.id} className="rounded border border-slate-150 bg-slate-50/50">
                      <div className="flex items-center justify-between px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800">{u.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                            {u.billing_type === "FIXED" ? "固定" : "従量"}
                          </span>
                          {!u.active && <span className="text-[10px] text-slate-400">無効</span>}
                        </div>
                        {canWrite && (
                          <div className="flex items-center gap-3 text-slate-400 text-xs">
                            <button title="編集" onClick={() => setModal({ kind: "unit", mode: "edit", carrierId: c.id, unit: u })} className="hover:text-slate-700">
                              <FontAwesomeIcon icon={faPenToSquare} />
                            </button>
                            <button title="削除" onClick={() => askDelete(`型「${u.name}」を削除しますか？`, () => apiFetch(`/api/admin/units/${u.id}`, { method: "DELETE" }))} className="hover:text-red-600">
                              <FontAwesomeIcon icon={faTrash} />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* fields */}
                      <div className="px-3 pb-2">
                        <table className="w-full text-xs">
                          <tbody>
                            {u.fields.map((f) => (
                              <tr key={f.id} className="border-t border-slate-100">
                                <td className="py-1.5 pr-2 text-slate-700">{f.label}</td>
                                <td className="py-1.5 px-2 text-slate-400 font-mono">{f.field_key}</td>
                                <td className="py-1.5 px-2 text-slate-500">{INPUT_TYPE_LABEL[f.input_type]}</td>
                                <td className="py-1.5 px-2">{f.group_label && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{f.group_label}</span>}</td>
                                <td className="py-1.5 px-2">{f.is_billable && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">課金数量</span>}</td>
                                {canWrite && (
                                  <td className="py-1.5 pl-2 text-right text-slate-400 whitespace-nowrap">
                                    <button title="編集" onClick={() => setModal({ kind: "field", mode: "edit", unitId: u.id, field: f })} className="hover:text-slate-700 mr-3">
                                      <FontAwesomeIcon icon={faPenToSquare} />
                                    </button>
                                    <button title="削除" onClick={() => askDelete(`項目「${f.label}」を削除しますか？`, () => apiFetch(`/api/admin/unit-fields/${f.id}`, { method: "DELETE" }))} className="hover:text-red-600">
                                      <FontAwesomeIcon icon={faTrash} />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {canWrite && (
                          <button onClick={() => setModal({ kind: "field", mode: "create", unitId: u.id })} className="mt-1.5 text-[11px] text-slate-500 hover:text-slate-800">
                            <FontAwesomeIcon icon={faPlus} className="mr-1" />報告項目を追加
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {canWrite && (
                    <button onClick={() => setModal({ kind: "unit", mode: "create", carrierId: c.id })} className="text-xs text-slate-600 hover:text-slate-900">
                      <FontAwesomeIcon icon={faPlus} className="mr-1" />型(unit)を追加
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <EditModal
          modal={modal}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={async (payload) => {
            setSaving(true);
            try {
              await submitModal(modal, payload);
              setModal(null);
              await load();
            } catch (e) {
              fail(e);
            } finally {
              setSaving(false);
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message ?? ""}
        onConfirm={confirmState?.onConfirm ?? (() => {})}
        onClose={() => setConfirmState(null)}
        confirmLabel="削除"
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

// API 呼び出し（create/edit を kind 別に振り分け）
async function submitModal(modal: ModalState, payload: Record<string, unknown>) {
  if (modal.kind === "carrier") {
    if (modal.mode === "create") return apiFetch("/api/admin/carriers", { method: "POST", body: JSON.stringify(payload) });
    return apiFetch(`/api/admin/carriers/${modal.carrier!.id}`, { method: "PATCH", body: JSON.stringify(payload) });
  }
  if (modal.kind === "unit") {
    if (modal.mode === "create") return apiFetch("/api/admin/units", { method: "POST", body: JSON.stringify({ ...payload, carrier_id: modal.carrierId }) });
    return apiFetch(`/api/admin/units/${modal.unit!.id}`, { method: "PATCH", body: JSON.stringify(payload) });
  }
  // field
  if (modal.mode === "create") return apiFetch("/api/admin/unit-fields", { method: "POST", body: JSON.stringify({ ...payload, unit_id: modal.unitId }) });
  return apiFetch(`/api/admin/unit-fields/${modal.field!.id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

function EditModal({
  modal,
  saving,
  onClose,
  onSave,
}: {
  modal: ModalState;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  // 各 kind のフォーム状態
  const [name, setName] = useState(modal.kind === "carrier" ? modal.carrier?.name ?? "" : modal.kind === "unit" ? modal.unit?.name ?? "" : "");
  const [code, setCode] = useState(modal.kind === "carrier" ? modal.carrier?.code ?? "" : modal.kind === "unit" ? modal.unit?.code ?? "" : "");
  const [billingType, setBillingType] = useState<BillingType>(modal.kind === "unit" ? modal.unit?.billing_type ?? "PER_PIECE" : "PER_PIECE");
  const [label, setLabel] = useState(modal.kind === "field" ? modal.field?.label ?? "" : "");
  const [fieldKey, setFieldKey] = useState(modal.kind === "field" ? modal.field?.field_key ?? "" : "");
  const [inputType, setInputType] = useState<InputType>(modal.kind === "field" ? modal.field?.input_type ?? "INT" : "INT");
  const [groupLabel, setGroupLabel] = useState(modal.kind === "field" ? modal.field?.group_label ?? "" : "");
  const [isBillable, setIsBillable] = useState(modal.kind === "field" ? modal.field?.is_billable ?? false : false);
  const [required, setRequired] = useState(modal.kind === "field" ? modal.field?.required ?? false : false);

  const title =
    modal.kind === "carrier" ? "キャリア" : modal.kind === "unit" ? "型(unit)" : "報告項目";

  function submit() {
    if (modal.kind === "carrier") return onSave({ name, code });
    if (modal.kind === "unit") return onSave({ name, code, billing_type: billingType });
    return onSave({ label, field_key: fieldKey, input_type: inputType, group_label: groupLabel, is_billable: isBillable, required });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md">
        <div className="px-5 pt-5 pb-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            {title}を{modal.mode === "create" ? "追加" : "編集"}
          </h2>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm">
          {(modal.kind === "carrier" || modal.kind === "unit") && (
            <>
              <Labeled label="名称">
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded" placeholder={modal.kind === "carrier" ? "例: ヤマト" : "例: 宅急便"} />
              </Labeled>
              <Labeled label="コード（任意・内部識別子）">
                <input value={code} onChange={(e) => setCode(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono" placeholder="空欄でOK" />
              </Labeled>
            </>
          )}
          {modal.kind === "unit" && (
            <Labeled label="課金タイプ（既定）">
              <select value={billingType} onChange={(e) => setBillingType(e.target.value as BillingType)} className="w-full px-2 py-1.5 border border-slate-300 rounded">
                <option value="PER_PIECE">従量（個数×単価）</option>
                <option value="FIXED">固定（日当）</option>
              </select>
            </Labeled>
          )}
          {modal.kind === "field" && (
            <>
              <Labeled label="ラベル（ドライバー画面の表示名）">
                <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded" placeholder="例: 完了個数" />
              </Labeled>
              <Labeled label="キー（任意・英数字）">
                <input value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono" placeholder="例: completed（空欄なら自動）" disabled={modal.mode === "edit"} />
              </Labeled>
              <Labeled label="入力タイプ">
                <select value={inputType} onChange={(e) => setInputType(e.target.value as InputType)} className="w-full px-2 py-1.5 border border-slate-300 rounded">
                  {(["INT", "TEXT", "TIME", "BOOL"] as InputType[]).map((t) => (
                    <option key={t} value={t}>{INPUT_TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </Labeled>
              <Labeled label="グループ見出し（任意・例: 午前/午後）">
                <input value={groupLabel} onChange={(e) => setGroupLabel(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded" placeholder="空欄でOK" />
              </Labeled>
              <label className="flex items-center gap-2 text-slate-700">
                <input type="checkbox" checked={isBillable} onChange={(e) => setIsBillable(e.target.checked)} />
                従量課金の数量として使う（例: 完了個数）
              </label>
              <label className="flex items-center gap-2 text-slate-700">
                <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                入力必須
              </label>
            </>
          )}
        </div>
        <div className="px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800">キャンセル</button>
          <button type="button" disabled={saving} onClick={submit} className="px-4 py-1.5 text-xs font-medium text-white bg-slate-900 rounded hover:bg-slate-700 disabled:opacity-50">
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
