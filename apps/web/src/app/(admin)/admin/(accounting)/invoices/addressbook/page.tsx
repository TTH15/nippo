"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAddressBook, faPlus } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { hasCapability } from "@/lib/capabilities";
import { Button } from "@/lib/ui/button";

type Address = {
  id: string;
  name: string;
  postal_code: string | null;
  address: string | null;
  phone: string | null;
  invoice_no: string | null;
  created_at: string;
};

function sortAddresses(list: Address[]): Address[] {
  return [...list].sort((a, b) => {
    const byName = (a.name || "").localeCompare(b.name || "", "ja");
    if (byName !== 0) return byName;
    return (a.id || "").localeCompare(b.id || "");
  });
}

const COMPANY_CODE = "AAA";

export default function AddressBookPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [form, setForm] = useState({
    name: "",
    postalCode: "",
    address: "",
    phone: "",
    invoiceNo: "",
  });
  const [saving, setSaving] = useState(false);
  const [companyCode, setCompanyCode] = useState(COMPANY_CODE);
  const [confirmState, setConfirmState] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    title: string;
    message: string;
    detail?: string;
  } | null>(null);

  useEffect(() => {
    const stored = getStoredDriver();
    setCanWrite(hasCapability("can_manage_billing"));
    if (stored?.companyCode) {
      setCompanyCode(stored.companyCode);
    }
  }, []);

  // SWR で住所録をキャッシュし、遷移をまたいで保持する（再訪時の点滅をなくす）。
  // addresses は楽観更新（作成/編集/削除）で setAddresses するため state を維持し、
  // 取得結果は同期エフェクトで流し込む。
  const { data: addrData, isInitialLoading, refresh: refreshAddresses } = useApi<{ addresses: Address[] }>(
    "/api/admin/invoice-addresses",
  );
  const loading = isInitialLoading;

  useEffect(() => {
    if (addrData) setAddresses(sortAddresses(addrData.addresses));
  }, [addrData]);

  const openNew = () => {
    if (!canWrite) return;
    setEditingAddress(null);
    setForm({ name: "", postalCode: "", address: "", phone: "", invoiceNo: "" });
    setShowModal(true);
  };

  const openEdit = (a: Address) => {
    if (!canWrite) return;
    setEditingAddress(a);
    setForm({
      name: a.name,
      postalCode: a.postal_code || "",
      address: a.address || "",
      phone: a.phone || "",
      invoiceNo: a.invoice_no || "",
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!canWrite) return;
    if (!form.name.trim()) {
      setErrorState({
        title: "会社名が入力されていません",
        message:
          "会社名が空のまま保存しようとしたため、アドレス帳を保存できませんでした。\n\n" +
          "会社名は請求書の宛先として必須です。会社名を入力してから、もう一度保存してください。",
      });
      return;
    }
    setSaving(true);
    try {
      if (editingAddress) {
        const res = await apiFetch<{ address: Address }>(`/api/admin/invoice-addresses/${editingAddress.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: form.name.trim(),
            postalCode: form.postalCode.trim() || null,
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
            invoiceNo: form.invoiceNo.trim() || null,
          }),
        });
        const updated = res.address;
        setAddresses((prev) =>
          sortAddresses(prev.map((a) => (a.id === editingAddress.id ? updated : a))),
        );
      } else {
        const res = await apiFetch<{ address: Address }>("/api/admin/invoice-addresses", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            postalCode: form.postalCode.trim() || null,
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
            invoiceNo: form.invoiceNo.trim() || null,
          }),
        });
        setAddresses((prev) => sortAddresses([...prev, res.address]));
      }
      setShowModal(false);
      void refreshAddresses(); // キャッシュも確定（待たない）
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "法人アドレスの保存に失敗しました",
        message:
          "サーバーでエラーが発生したため、法人アドレスを保存できませんでした。\n\n" +
          "入力内容（郵便番号・住所・電話番号など）に誤りがないか確認し、もう一度保存してください。\n" +
          "同じエラーが続く場合は、システム管理者に連絡してください。",
        detail: reason || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteAddress = async (id: string, name: string) => {
    if (!canWrite) return;
    setConfirmState({
      message: `${name}を削除しますか？`,
      onConfirm: async () => {
        try {
          await apiFetch(`/api/admin/invoice-addresses/${id}`, { method: "DELETE" });
          setAddresses((prev) => prev.filter((a) => a.id !== id));
          void refreshAddresses();
        } catch (e) {
          console.error(e);
          const reason = e instanceof Error ? e.message : "";
          setErrorState({
            title: "法人アドレスの削除に失敗しました",
            message:
              "サーバーでエラーが発生したため、この法人アドレスを削除できませんでした。\n\n" +
              "請求書で既に使用されている場合などに失敗することがあります。時間をおいて再度お試しいただくか、システム管理者に連絡してください。",
            detail: reason || undefined,
          });
        }
      },
    });
  };

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-3">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <FontAwesomeIcon icon={faAddressBook} className="w-5 h-5 text-slate-400" />
            法人アドレス帳
          </h1>
          {canWrite && (
            <Button variant="default" size="default" onClick={openNew}>
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              新規追加
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-5 leading-relaxed">
          請求書作成時に請求先（法人）として選択できる宛先を管理します。個人（ドライバー）はドライバー管理で登録してください。
        </p>

        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <Skeleton className="h-4 w-40 mb-2" />
                    <div className="space-y-1">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-3 w-full max-w-xs" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Skeleton className="h-4 w-10" />
                    <Skeleton className="h-4 w-10" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : addresses.length === 0 ? (
          <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
            <p className="text-slate-500 mb-2">登録された法人アドレスはありません</p>
            <p className="text-xs text-slate-400 mb-4">
              請求書作成時に請求先として選択できます。個人（ドライバー）はドライバー管理で登録してください。
            </p>
            {canWrite && (
              <Button variant="default" size="default" onClick={openNew}>
                <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
                法人を追加
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {addresses.map((a) => (
              <div
                key={a.id}
                className="soft-rise bg-white rounded-lg border border-slate-200 p-4 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">{a.name}</h3>
                    <div className="mt-2 text-sm text-slate-600 space-y-0.5">
                      {a.postal_code && <div>〒 {a.postal_code}</div>}
                      {a.address && <div>{a.address}</div>}
                      {a.phone && <div>電話: {a.phone}</div>}
                      {a.invoice_no && <div>登録番号: {a.invoice_no}</div>}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {canWrite && (
                      <>
                        <button
                          onClick={() => openEdit(a)}
                          className="text-xs text-slate-500 hover:text-slate-800 transition-colors"
                        >
                          編集
                        </button>
                        <button
                          onClick={() => deleteAddress(a.id, a.name)}
                          className="text-xs text-red-500 hover:text-red-700 transition-colors"
                        >
                          削除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && canWrite && (
        <div className="modal-backdrop-in fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="modal-panel-in bg-white rounded-lg shadow-lg w-full max-w-md max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">
                {editingAddress ? "法人を編集" : "法人を追加"}
              </h2>
            </div>

            <div className="px-5 py-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">会社名 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="株式会社○○"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">郵便番号</label>
                <input
                  type="text"
                  value={form.postalCode}
                  onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                  placeholder="123-4567"
                  maxLength={8}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">住所</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="東京都○○区○○1-2-3"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">電話番号</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="03-1234-5678"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">インボイス登録番号</label>
                <input
                  type="text"
                  value={form.invoiceNo}
                  onChange={(e) => setForm((f) => ({ ...f, invoiceNo: e.target.value }))}
                  placeholder="T1234567890123"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>

            <div className="px-5 py-3 flex justify-end gap-2 border-t border-slate-100">
              <Button variant="ghost" size="sm" onClick={() => setShowModal(false)}>
                キャンセル
              </Button>
              <Button variant="default" size="sm" onClick={save} disabled={saving || !form.name.trim()}>
                {saving ? "保存中..." : "保存"}
              </Button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmState}
        message={confirmState?.message ?? ""}
        onConfirm={confirmState?.onConfirm ?? (() => { })}
        onClose={() => setConfirmState(null)}
        confirmLabel="削除"
      />
      <ErrorDialog
        open={!!errorState}
        title={errorState?.title}
        message={errorState?.message ?? ""}
        detail={errorState?.detail}
        onClose={() => setErrorState(null)}
      />
    </AdminLayout>
  );
}
