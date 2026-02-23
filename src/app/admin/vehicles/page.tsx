"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { apiFetch } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";

const LEASE_COST = 35000; // 月々リース代

/**
 * 一連番号を4桁配列で返す。空き桁は "・"。
 * 右詰めで数字が入る（電卓方式）。
 */
function plateDigits(raw: string): [string, string, string, string] {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  const arr: string[] = Array(4).fill("・");
  for (let i = 0; i < digits.length; i++) {
    arr[4 - digits.length + i] = digits[i];
  }
  return arr as [string, string, string, string];
}

/**
 * プレート表示用フォーマット。4桁のときのみハイフン、それ以外はスペース。
 * 例: "2123"→"21-23", "254"→"・2 54", "43"→"・・ 43"
 */
function formatPlateNumeric(raw: string): string {
  const d = plateDigits(raw);
  const digits = raw.replace(/\D/g, "");
  const sep = digits.length === 4 ? "-" : " ";
  return `${d[0]}${d[1]}${sep}${d[2]}${d[3]}`;
}

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
  manufacturer?: string | null;
  brand?: string | null;
  number_prefix?: string | null;
  number_class?: string | null;
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
    manufacturer: "",
    brand: "",
    numberPrefix: "",
    numberClass: "",
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
      manufacturer: "",
      brand: "",
      numberPrefix: "",
      numberClass: "",
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
      manufacturer: v.manufacturer || "",
      brand: v.brand || "",
      numberPrefix: v.number_prefix || "",
      numberClass: v.number_class || "",
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

              // 登録順のNoを計算（配列のインデックス+1）
              const vehicleIndex = vehicles.findIndex((veh) => veh.id === v.id);
              const vehicleNo = vehicleIndex >= 0 ? vehicleIndex + 1 : 1;

              return (
                <div key={v.id} className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm relative">
                  {/* 右上の編集アイコン */}
                  <button
                    onClick={() => openEdit(v)}
                    className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 transition-colors"
                    title="編集"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>

                  <div className="flex gap-8">
                    {/* 左側: No、ドライバーラベル、ナンバープレート、写真、車種 */}
                    <div className="flex-shrink-0 w-64 space-y-4">
                      {/* No + ドライバーラベル（横並び） */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xl font-bold text-slate-900">
                          No.{String(vehicleNo).padStart(4, "0")}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {vehicleDrivers.length > 0 ? (
                            vehicleDrivers.map((vd) => (
                              <span
                                key={vd.driver_id}
                                className="px-2.5 py-1 bg-slate-800 text-white text-xs rounded font-medium"
                              >
                                {getDisplayName(vd.drivers)}
                              </span>
                            ))
                          ) : (
                            <span className="px-2.5 py-1 bg-slate-50 text-slate-400 text-xs rounded">未設定</span>
                          )}
                        </div>
                      </div>

                      {/* ナンバープレート */}
                      {(v.number_prefix || v.number_hiragana || v.number_numeric) && (
                        <div
                          className="relative bg-black rounded-lg overflow-hidden"
                          style={{
                            aspectRatio: "2 / 1",
                            maxWidth: "240px",
                            border: "2.5px solid #b8a038",
                            boxShadow: "inset 0 0 0 2px #1a1a1a, 0 2px 8px rgba(0,0,0,0.3)",
                          }}
                        >
                          {/* ボルト穴（左上） */}
                          <div
                            className="absolute flex items-center justify-center"
                            style={{ top: "10%", left: "12%", width: "12px", height: "12px" }}
                          >
                            <div
                              className="rounded-full"
                              style={{
                                width: "10px",
                                height: "10px",
                                // border: "1.5px solid #a09030",
                                background: "radial-gradient(circle at 40% 40%, #555 0%, #222 60%, #111 100%)",
                              }}
                            />
                          </div>
                          {/* ボルト穴（右上） */}
                          <div
                            className="absolute flex items-center justify-center"
                            style={{ top: "10%", right: "12%", width: "12px", height: "12px" }}
                          >
                            <div
                              className="rounded-full"
                              style={{
                                width: "10px",
                                height: "10px",
                                // border: "1.5px solid #a09030",
                                background: "radial-gradient(circle at 40% 40%, #555 0%, #222 60%, #111 100%)",
                              }}
                            />
                          </div>
                          {/* プレート内容 */}
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            {/* 上段: 地域名 + 分類番号 */}
                            <div
                              className="flex items-baseline gap-1.5 pt-3"
                              style={{ color: "#e8d44d", marginBottom: "2px" }}
                            >
                              <span className="plate-font-kanji" style={{ fontSize: "1.9rem", letterSpacing: "0.08em" }}>
                                {v.number_prefix || "京都"}
                              </span>
                              <span className="plate-font-numeric" style={{ fontSize: "1.75rem", letterSpacing: "0.06em" }}>
                                {v.number_class || "400"}
                              </span>
                            </div>
                            {/* 下段: ひらがな + 一連番号 */}
                            <div
                              className="flex items-center pb-3"
                              style={{ color: "#e8d44d", gap: "0.35rem" }}
                            >
                              <span
                                className="plate-font-hiragana font-bold flex items-center"
                                style={{ fontSize: "2rem", lineHeight: 1, height: "100%" }}
                              >
                                {v.number_hiragana || "わ"}
                              </span>
                              <span
                                className="plate-font-numeric font-black tracking-wider"
                                style={{
                                  fontSize: "4rem",
                                  lineHeight: 1,
                                  letterSpacing: "0.02em",
                                  textShadow: "0 0 6px rgba(232,212,77,0.3)",
                                }}
                              >
                                {formatPlateNumeric(v.number_numeric || "")}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 車両画像プレースホルダー（16:9） */}
                      <div className="w-full aspect-video bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-sm overflow-hidden">
                        <span>車両画像</span>
                      </div>

                      {/* 車種（メーカー名とブランド名を分けて表示） */}
                      {(v.manufacturer || v.brand) && (
                        <div>
                          {v.manufacturer && (
                            <span className="text-xs text-slate-500">{v.manufacturer}</span>
                          )}
                          {v.manufacturer && v.brand && <span className="text-xs text-slate-500 mx-1"> </span>}
                          {v.brand && (
                            <span className="text-lg font-semibold text-slate-900">{v.brand}</span>
                          )}
                        </div>
                      )}
                      {!v.manufacturer && !v.brand && v.name && (
                        <div className="text-sm text-slate-600">{v.name}</div>
                      )}
                    </div>

                    {/* 右側: 次回車検・定期点検、オイル交換ゲージ、回収ROIゲージ */}
                    <div className="flex-1 space-y-6">
                      {/* 次回車検・定期点検（横並び） */}
                      <div className="flex items-center gap-6 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600">次回車検</span>
                          <span className="font-medium text-slate-900">2026年8月</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600">次回定期点検</span>
                          <span className="font-medium text-slate-900">2026年2月</span>
                        </div>
                      </div>

                      {/* オイル交換ゲージ */}
                      <div className="pt-2">
                        {/* ラベル行 */}
                        <div className="relative h-10 mb-1">
                          {/* 前回オイル交換（左端） */}
                          <div className="absolute left-0 top-0 text-left">
                            <div className="text-[10px] text-slate-500 leading-tight">前回オイル交換</div>
                            <div className="text-xs font-medium text-slate-800 leading-tight">{fmt(v.last_oil_change_mileage)} km</div>
                          </div>
                          {/* 現在走行距離（現在位置） */}
                          <div
                            className="absolute top-0 whitespace-nowrap"
                            style={{
                              left: `${oilProgress}%`,
                              transform: `translateX(${oilProgress > 70 ? "-80%" : oilProgress < 30 ? "0%" : "-50%"})`,
                            }}
                          >
                            <div className="text-[10px] text-slate-500 leading-tight">現在走行距離</div>
                            <div className="text-xs font-bold text-slate-900 leading-tight">{fmt(v.current_mileage)} km</div>
                          </div>
                          {/* 次回オイル交換（右端） */}
                          <div className="absolute right-0 top-0 text-right">
                            <div className="text-[10px] text-slate-500 leading-tight">次回オイル交換</div>
                            <div className="text-xs font-medium text-slate-800 leading-tight">{fmt(nextOilChangeKm)} km</div>
                          </div>
                        </div>
                        {/* ▼ マーカー行 */}
                        <div className="relative h-3">
                          {/* 前回位置 ▼ */}
                          <div className="absolute left-0 top-0 -translate-x-[3px] text-slate-400 text-[10px] leading-none">▼</div>
                          {/* 現在位置 ▼ */}
                          <div
                            className="absolute top-0 text-green-600 text-[10px] leading-none"
                            style={{ left: `${oilProgress}%`, transform: "translateX(-50%)" }}
                          >▼</div>
                        </div>
                        {/* ゲージバー */}
                        <div className="relative h-2.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`absolute top-0 left-0 h-full rounded-full transition-all ${oilRemaining > 0 ? "bg-green-500" : "bg-red-500"
                              }`}
                            style={{ width: `${Math.min(oilProgress, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* 回収ROIゲージ */}
                      <div className="flex gap-3 items-start">
                        {/* 左側: ラベルと金額（縦並び、ゲージの位置に対応） */}
                        <div className="flex flex-col text-xs text-slate-600 min-w-[110px]">
                          <div className="mb-1">
                            <div className="text-slate-500 text-[10px]">回収済み</div>
                            <div className="font-medium text-xs">{fmt(recovered)}円</div>
                          </div>
                          <div className="flex-1 flex items-center">
                            {remainingMonths !== null && remainingMonths > 0 && (
                              <div>
                                <div className="text-slate-500 text-[10px]">回収まで</div>
                                <div className="font-medium text-xs text-blue-600">残り約{remainingMonths}ヶ月</div>
                              </div>
                            )}
                            {purchaseCost > 0 && recovered >= purchaseCost && (
                              <div className="font-medium text-xs text-green-600">✓ 回収完了</div>
                            )}
                          </div>
                          <div className="mt-auto">
                            <div className="text-slate-500 text-[10px]">購入費用</div>
                            <div className="font-medium text-xs text-slate-900">{fmt(purchaseCost)}円</div>
                          </div>
                        </div>
                        {/* 右側: ゲージ */}
                        <div className="flex-1 relative h-20 bg-blue-50 rounded border border-blue-200 overflow-hidden">
                          <div
                            className="absolute top-0 left-0 h-full bg-blue-600 transition-all"
                            style={{ width: `${recoveryProgress}%` }}
                          />
                          <div className="absolute inset-0 flex flex-col justify-between py-1 px-2">
                            <div className="text-[10px] font-medium text-blue-900">{fmt(recovered)}</div>
                            <div className="text-[10px] font-medium text-blue-900 text-right">{fmt(purchaseCost)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">メーカー名</label>
                    <input
                      type="text"
                      value={form.manufacturer}
                      onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))}
                      placeholder="例: スズキ"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">ブランド名</label>
                    <input
                      type="text"
                      value={form.brand}
                      onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                      placeholder="例: エブリイ"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">ナンバープレート</label>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <input
                      type="text"
                      value={form.numberPrefix}
                      onChange={(e) => setForm((f) => ({ ...f, numberPrefix: e.target.value }))}
                      placeholder="地域名（例: 京都）"
                      className="px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <input
                      type="text"
                      value={form.numberClass}
                      onChange={(e) => setForm((f) => ({ ...f, numberClass: e.target.value }))}
                      placeholder="分類（例: 400）"
                      className="px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <input
                      type="text"
                      value={form.numberHiragana}
                      onChange={(e) => setForm((f) => ({ ...f, numberHiragana: e.target.value }))}
                      placeholder="かな（例: わ）"
                      maxLength={1}
                      className="px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <label className="block text-xs text-slate-500 mb-1">一連番号（数字のみ・右詰め・4桁でハイフン）</label>
                  <div
                    className="inline-flex items-center gap-1 cursor-text"
                    onClick={(e) => {
                      (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus();
                    }}
                  >
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={form.numberNumeric}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                        setForm((f) => ({ ...f, numberNumeric: v }));
                      }}
                      onKeyDown={(e) => {
                        if (
                          !/^\d$/.test(e.key) &&
                          !["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) &&
                          !e.metaKey && !e.ctrlKey
                        ) {
                          e.preventDefault();
                        }
                      }}
                      maxLength={4}
                      className="sr-only"
                    />
                    {(() => {
                      const d = plateDigits(form.numberNumeric);
                      const filled = form.numberNumeric.replace(/\D/g, "").length;
                      return (
                        <>
                          {d.slice(0, 2).map((c, i) => (
                            <div
                              key={`d${i}`}
                              className={`w-10 h-10 flex items-center justify-center rounded-lg border-2 text-base font-bold transition-colors ${c === "・"
                                ? "border-slate-200 bg-slate-50 text-slate-300"
                                : "border-slate-400 bg-white text-slate-900"
                                }`}
                            >
                              {c}
                            </div>
                          ))}
                          <span className="text-slate-400 font-bold text-lg w-4 text-center select-none">
                            {filled === 4 ? "-" : ""}
                          </span>
                          {d.slice(2).map((c, i) => (
                            <div
                              key={`d${i + 2}`}
                              className={`w-10 h-10 flex items-center justify-center rounded-lg border-2 text-base font-bold transition-colors ${c === "・"
                                ? "border-slate-200 bg-slate-50 text-slate-300"
                                : "border-slate-400 bg-white text-slate-900"
                                }`}
                            >
                              {c}
                            </div>
                          ))}
                        </>
                      );
                    })()}
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
                        className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors ${form.driverIds.includes(d.id)
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

              <div className="flex flex-col gap-3 mt-6">
                <div className="flex justify-end gap-2">
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
                {editingVehicle && (
                  <div className="pt-3 border-t border-slate-200">
                    <button
                      onClick={() => {
                        if (confirm(`${editingVehicle.name}を削除しますか？`)) {
                          deleteVehicle(editingVehicle.id, editingVehicle.name);
                          setShowModal(false);
                        }
                      }}
                      className="w-full px-4 py-2 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors"
                    >
                      削除
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
