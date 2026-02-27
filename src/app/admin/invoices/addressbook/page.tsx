"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { canAdminWrite } from "@/lib/authz";

type Address = {
  id: string;
  name: string;
  postal_code: string | null;
  address: string | null;
  phone: string | null;
  invoice_no: string | null;
  created_at: string;
};

const COMPANY_CODE = "AAA";

export default function AddressBookPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    const stored = getStoredDriver();
    setCanWrite(canAdminWrite(stored?.role));
    if (stored?.companyCode) {
      setCompanyCode(stored.companyCode);
    }
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ addresses: Address[] }>("/api/admin/invoice-addresses");
      setAddresses(res.addresses);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
      alert("会社名を入力してください");
      return;
    }
    setSaving(true);
    try {
      if (editingAddress) {
        await apiFetch(`/api/admin/invoice-addresses/${editingAddress.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: form.name.trim(),
            postalCode: form.postalCode.trim() || null,
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
            invoiceNo: form.invoiceNo.trim() || null,
          }),
        });
      } else {
        await apiFetch("/api/admin/invoice-addresses", {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            postalCode: form.postalCode.trim() || null,
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
            invoiceNo: form.invoiceNo.trim() || null,
          }),
        });
      }
      setShowModal(false);
      load();
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const deleteAddress = async (id: string, name: string) => {
    if (!canWrite) return;
    if (!confirm(`${name}を削除しますか？`)) return;
    try {
      await apiFetch(`/api/admin/invoice-addresses/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      console.error(e);
      alert("削除に失敗しました");
    }
  };

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-900">アドレス帳（法人）</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              請求書の請求先として使用する法人情報。会社コード: {companyCode}
            </p>
          </div>
          {canWrite && (
            <button
              onClick={openNew}
              className="px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
            >
              法人を追加
            </button>
          )}
        </div>

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
              <button
                onClick={openNew}
                className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
              >
                法人を追加
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {addresses.map((a) => (
              <div
                key={a.id}
                className="bg-white rounded-lg border border-slate-200 p-4 hover:border-slate-300 transition-colors"
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {editingAddress ? "法人を編集" : "法人を追加"}
            </h2>

            <div className="space-y-4">
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

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={save}
                disabled={saving || !form.name.trim()}
                className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
