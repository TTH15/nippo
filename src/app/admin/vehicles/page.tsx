"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";

type Vehicle = {
  id: string;
  name: string;
  current_mileage: number;
  last_oil_change_mileage: number;
  oil_change_interval: number;
  updated_at: string;
};

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [form, setForm] = useState({
    name: "",
    currentMileage: 0,
    lastOilChangeMileage: 0,
    oilChangeInterval: 5000,
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ vehicles: Vehicle[] }>("/api/admin/vehicles");
      setVehicles(res.vehicles);
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
    setEditingVehicle(null);
    setForm({
      name: "",
      currentMileage: 0,
      lastOilChangeMileage: 0,
      oilChangeInterval: 5000,
    });
    setShowModal(true);
  };

  const openEdit = (v: Vehicle) => {
    setEditingVehicle(v);
    setForm({
      name: v.name,
      currentMileage: v.current_mileage,
      lastOilChangeMileage: v.last_oil_change_mileage,
      oilChangeInterval: v.oil_change_interval,
    });
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editingVehicle) {
        await apiFetch(`/api/admin/vehicles/${editingVehicle.id}`, {
          method: "PUT",
          body: JSON.stringify(form),
        });
      } else {
        await apiFetch("/api/admin/vehicles", {
          method: "POST",
          body: JSON.stringify(form),
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

  const deleteVehicle = async (id: string, name: string) => {
    if (!confirm(`${name}を削除しますか？`)) return;
    try {
      await apiFetch(`/api/admin/vehicles/${id}`, { method: "DELETE" });
      load();
    } catch (e) {
      console.error(e);
      alert("削除に失敗しました");
    }
  };

  const getRemainingKm = (v: Vehicle) => {
    const nextOilChange = v.last_oil_change_mileage + v.oil_change_interval;
    return nextOilChange - v.current_mileage;
  };

  const getStatusColor = (remaining: number) => {
    if (remaining <= 0) return { text: "text-red-700", bg: "bg-red-100", bar: "bg-red-500" };
    if (remaining < 500) return { text: "text-amber-700", bg: "bg-amber-100", bar: "bg-amber-500" };
    return { text: "text-green-700", bg: "bg-green-100", bar: "bg-green-500" };
  };

  const fmt = (n: number) => n.toLocaleString("ja-JP");

  return (
    <AdminLayout>
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">車両管理</h1>
          <button
            onClick={openNew}
            className="px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
          >
            新規追加
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">読み込み中...</p>
        ) : vehicles.length === 0 ? (
          <p className="text-sm text-slate-500">車両が登録されていません</p>
        ) : (
          <div className="space-y-3">
            {vehicles.map((v) => {
              const remaining = getRemainingKm(v);
              const status = getStatusColor(remaining);
              const nextOilChange = v.last_oil_change_mileage + v.oil_change_interval;
              const progress = Math.max(0, Math.min(100, (remaining / v.oil_change_interval) * 100));

              return (
                <div
                  key={v.id}
                  className="bg-white rounded border border-slate-200 p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-medium text-slate-900">{v.name}</h3>
                    <div className="flex gap-3 text-xs">
                      <button
                        onClick={() => openEdit(v)}
                        className="text-slate-500 hover:text-slate-800 transition-colors"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => deleteVehicle(v.id, v.name)}
                        className="text-red-500 hover:text-red-700 transition-colors"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-4 text-sm mb-3">
                    <div>
                      <p className="text-xs text-slate-500">現在</p>
                      <p className="font-medium text-slate-800">{fmt(v.current_mileage)} km</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">次回交換</p>
                      <p className="font-medium text-slate-800">{fmt(nextOilChange)} km</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">交換間隔</p>
                      <p className="font-medium text-slate-800">{fmt(v.oil_change_interval)} km</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">残り</p>
                      <p className={`font-medium ${status.text}`}>
                        {remaining > 0 ? `${fmt(remaining)} km` : "要交換"}
                      </p>
                    </div>
                  </div>

                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${status.bar}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              {editingVehicle ? "車両情報編集" : "新規車両追加"}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">車両名</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="例: 軽バン 4号"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">現在メーター (km)</label>
                <input
                  type="number"
                  value={form.currentMileage}
                  onChange={(e) => setForm((f) => ({ ...f, currentMileage: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">前回オイル交換時 (km)</label>
                <input
                  type="number"
                  value={form.lastOilChangeMileage}
                  onChange={(e) => setForm((f) => ({ ...f, lastOilChangeMileage: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">交換間隔 (km)</label>
                <input
                  type="number"
                  value={form.oilChangeInterval}
                  onChange={(e) => setForm((f) => ({ ...f, oilChangeInterval: Number(e.target.value) }))}
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
                disabled={saving || !form.name}
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
