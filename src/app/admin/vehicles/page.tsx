"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";

const LEASE_COST = 35000; // 月々リース代

type Driver = {
  id: string;
  name: string;
  display_name?: string | null;
};

type VehicleDriver = {
  driver_id: string;
  drivers: Driver;
};

type Vehicle = {
  id: string;
  name: string;
  number_prefix?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  current_mileage: number;
  last_oil_change_mileage: number;
  oil_change_interval: number;
  purchase_cost: number;
  monthly_insurance: number;
  created_at: string;
  vehicle_drivers?: VehicleDriver[];
};

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [form, setForm] = useState({
    name: "",
    numberPrefix: "",
    numberHiragana: "",
    numberNumeric: "",
    currentMileage: 0,
    lastOilChangeMileage: 0,
    oilChangeInterval: 3000,
    purchaseCost: 0,
    monthlyInsurance: 0,
    driverIds: [] as string[],
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [vehiclesRes, driversRes] = await Promise.all([
        apiFetch<{ vehicles: Vehicle[] }>("/api/admin/vehicles"),
        apiFetch<{ drivers: Array<Driver & { role?: string }> }>("/api/admin/users"),
      ]);
      setVehicles(vehiclesRes.vehicles);
      setDrivers(driversRes.drivers.filter((d) => !d.role || d.role === "DRIVER"));
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
      numberPrefix: "",
      numberHiragana: "",
      numberNumeric: "",
      currentMileage: 0,
      lastOilChangeMileage: 0,
      oilChangeInterval: 3000,
      purchaseCost: 0,
      monthlyInsurance: 0,
      driverIds: [],
    });
    setShowModal(true);
  };

  const openEdit = (v: Vehicle) => {
    setEditingVehicle(v);
    setForm({
      name: v.name,
      numberPrefix: v.number_prefix || "",
      numberHiragana: v.number_hiragana || "",
      numberNumeric: v.number_numeric || "",
      currentMileage: v.current_mileage,
      lastOilChangeMileage: v.last_oil_change_mileage,
      oilChangeInterval: v.oil_change_interval,
      purchaseCost: v.purchase_cost || 0,
      monthlyInsurance: v.monthly_insurance || 0,
      driverIds: v.vehicle_drivers?.map((vd) => vd.driver_id) || [],
    });
    setShowModal(true);
  };

  const toggleDriver = (driverId: string) => {
    setForm((f) => ({
      ...f,
      driverIds: f.driverIds.includes(driverId)
        ? f.driverIds.filter((id) => id !== driverId)
        : [...f.driverIds, driverId],
    }));
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

  // オイル交換までの残りkm
  const getOilRemainingKm = (v: Vehicle) => {
    const nextOilChange = v.last_oil_change_mileage + v.oil_change_interval;
    return nextOilChange - v.current_mileage;
  };

  // 月々回収額（リース代 - 保険料）
  const getMonthlyRecovery = (v: Vehicle) => {
    return LEASE_COST - (v.monthly_insurance || 0);
  };

  // 回収済み金額（経過月数 × 月々回収額）
  const getRecoveredAmount = (v: Vehicle) => {
    const monthsElapsed = Math.floor(
      (new Date().getTime() - new Date(v.created_at).getTime()) / (1000 * 60 * 60 * 24 * 30)
    );
    return monthsElapsed * getMonthlyRecovery(v);
  };

  // 回収まで残り月数
  const getRemainingMonths = (v: Vehicle) => {
    const recovered = getRecoveredAmount(v);
    const remaining = (v.purchase_cost || 0) - recovered;
    const monthly = getMonthlyRecovery(v);
    if (monthly <= 0) return null;
    return Math.ceil(remaining / monthly);
  };

  const fmt = (n: number) => n.toLocaleString("ja-JP");

  return (
    <AdminLayout>
      <div className="max-w-6xl">
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
          <div className="space-y-4">
            {vehicles.map((v) => {
              const oilRemaining = getOilRemainingKm(v);
              const nextOilChangeKm = v.last_oil_change_mileage + v.oil_change_interval;
              const oilProgress = Math.max(
                0,
                Math.min(100, ((v.current_mileage - v.last_oil_change_mileage) / v.oil_change_interval) * 100)
              );
              const recovered = getRecoveredAmount(v);
              const purchaseCost = v.purchase_cost || 0;
              const recoveryProgress = purchaseCost > 0 ? Math.min(100, (recovered / purchaseCost) * 100) : 0;
              const remainingMonths = getRemainingMonths(v);
              const vehicleDrivers = v.vehicle_drivers || [];

              return (
                <div key={v.id} className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
                  {/* ヘッダー: No. + ドライバーラベル + ナンバープレート */}
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-lg font-bold text-slate-900">No.{v.name.replace(/\D/g, "") || "0001"}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {vehicleDrivers.length > 0 ? (
                          vehicleDrivers.map((vd) => (
                            <span
                              key={vd.driver_id}
                              className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded font-medium"
                            >
                              {getDisplayName(vd.drivers)}
                            </span>
                          ))
                        ) : (
                          <span className="px-2 py-0.5 bg-slate-50 text-slate-400 text-xs rounded">未設定</span>
                        )}
                      </div>
                    </div>
                    {(v.number_prefix || v.number_hiragana || v.number_numeric) && (
                      <div className="bg-black text-yellow-300 px-3 py-1.5 rounded font-mono text-sm font-bold border-2 border-yellow-400">
                        <div className="text-center leading-tight">
                          <div>{v.number_prefix || "京都"}</div>
                          <div className="text-xs mt-0.5">
                            {v.number_hiragana || "と"} {v.number_numeric || "00-00"}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* 左側: 車両情報 */}
                    <div className="space-y-4">
                      {/* 車両画像プレースホルダー */}
                      <div className="h-32 bg-slate-100 rounded flex items-center justify-center text-slate-400 text-sm">
                        車両画像
                      </div>
                      <div className="text-sm text-slate-600">{v.name}</div>

                      {/* 次回車検・定期点検 */}
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-slate-500">次回車検</span>
                          <span className="ml-2 font-medium text-slate-900">2026年8月</span>
                        </div>
                        <div>
                          <span className="text-slate-500">次回定期点検</span>
                          <span className="ml-2 font-medium text-slate-900">2026年2月</span>
                        </div>
                      </div>

                      {/* オイル交換ゲージ */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-600">
                          <span>前回オイル交換</span>
                          <span className="font-medium">{fmt(v.last_oil_change_mileage)} km</span>
                        </div>
                        <div className="relative h-8 bg-green-50 rounded border border-green-200">
                          <div
                            className="absolute top-0 left-0 h-full bg-green-400 rounded"
                            style={{ width: `${oilProgress}%` }}
                          />
                          <div
                            className="absolute top-0 h-full w-0.5 bg-green-700 z-10"
                            style={{ left: `${oilProgress}%` }}
                          />
                          <div className="absolute inset-0 flex items-center justify-between px-2 text-xs font-medium text-green-900">
                            <span>{fmt(v.last_oil_change_mileage)}</span>
                            <span>{fmt(nextOilChangeKm)}</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">次回オイル交換</span>
                          <span className="font-medium text-slate-900">{fmt(nextOilChangeKm)} km</span>
                          <button
                            onClick={() => openEdit(v)}
                            className="text-slate-400 hover:text-slate-600"
                            title="編集"
                          >
                            ✏️
                          </button>
                        </div>
                        <div className="text-xs text-slate-600">
                          現在走行距離: <span className="font-medium">{fmt(v.current_mileage)} km</span>
                          {oilRemaining > 0 ? (
                            <span className="ml-2 text-green-600">あと {fmt(oilRemaining)} km</span>
                          ) : (
                            <span className="ml-2 text-red-600">交換時期です</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 右側: 回収ROIゲージ */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-600">
                          <span>回収済み</span>
                          <span className="font-medium">{fmt(recovered)}円</span>
                        </div>
                        <div className="relative h-8 bg-blue-50 rounded border border-blue-200">
                          <div
                            className="absolute top-0 left-0 h-full bg-blue-600 rounded"
                            style={{ width: `${recoveryProgress}%` }}
                          />
                          <div className="absolute inset-0 flex items-center justify-between px-2 text-xs font-medium text-blue-900">
                            <span>{fmt(recovered)}</span>
                            <span>{fmt(purchaseCost)}</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">購入費用</span>
                          <span className="font-medium text-slate-900">{fmt(purchaseCost)}円</span>
                          <button
                            onClick={() => deleteVehicle(v.id, v.name)}
                            className="text-slate-400 hover:text-red-600"
                            title="削除"
                          >
                            🗑️
                          </button>
                        </div>
                        {remainingMonths !== null && remainingMonths > 0 && (
                          <div className="text-xs text-slate-600">
                            回収まで: <span className="font-medium text-blue-600">残り約{remainingMonths}ヶ月</span>
                          </div>
                        )}
                        {purchaseCost > 0 && recovered >= purchaseCost && (
                          <div className="text-xs font-medium text-green-600">✓ 回収完了</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 編集・削除ボタン */}
                  <div className="mt-4 pt-4 border-t border-slate-200 flex justify-end gap-2">
                    <button
                      onClick={() => openEdit(v)}
                      className="px-3 py-1 text-xs text-slate-600 hover:text-slate-800 transition-colors"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => deleteVehicle(v.id, v.name)}
                      className="px-3 py-1 text-xs text-red-500 hover:text-red-700 transition-colors"
                    >
                      削除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
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
                    placeholder="例: 軽バン 1号"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">ナンバープレート</label>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={form.numberPrefix}
                      onChange={(e) => setForm((f) => ({ ...f, numberPrefix: e.target.value }))}
                      placeholder="都道府県（例: 京都）"
                      className="px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <input
                      type="text"
                      value={form.numberHiragana}
                      onChange={(e) => setForm((f) => ({ ...f, numberHiragana: e.target.value }))}
                      placeholder="ひらがな（例: と）"
                      maxLength={1}
                      className="px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <input
                      type="text"
                      value={form.numberNumeric}
                      onChange={(e) => setForm((f) => ({ ...f, numberNumeric: e.target.value }))}
                      placeholder="数字（例: 00-00）"
                      className="px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">利用ドライバー</label>
                  <div className="flex flex-wrap gap-2">
                    {drivers.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggleDriver(d.id)}
                        className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${
                          form.driverIds.includes(d.id)
                            ? "bg-slate-800 text-white border-slate-800"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {getDisplayName(d)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
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
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">交換間隔 (km)</label>
                  <input
                    type="number"
                    value={form.oilChangeInterval}
                    onChange={(e) => setForm((f) => ({ ...f, oilChangeInterval: Number(e.target.value) }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <p className="text-xs text-slate-500 mt-1">デフォルト: 3,000km</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">購入費用 (円)</label>
                    <input
                      type="number"
                      value={form.purchaseCost}
                      onChange={(e) => setForm((f) => ({ ...f, purchaseCost: Number(e.target.value) }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">月々保険料 (円)</label>
                    <input
                      type="number"
                      value={form.monthlyInsurance}
                      onChange={(e) => setForm((f) => ({ ...f, monthlyInsurance: Number(e.target.value) }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <p className="text-xs text-slate-500 mt-1">リース代35,000円から差し引きます</p>
                  </div>
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
        </div>
      )}
    </AdminLayout>
  );
}
