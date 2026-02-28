"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faFileLines } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { DatePicker } from "@/lib/components/DatePicker";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { VehiclePlate, plateDigits } from "@/lib/components/VehiclePlate";
import { format } from "date-fns";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";
import { canAdminWrite } from "@/lib/authz";

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
  next_shaken_date?: string | null;
  next_periodic_inspection_date?: string | null;
  created_at: string;
  vehicle_drivers?: VehicleDriver[];
};

export default function VehiclesPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [form, setForm] = useState({
    manufacturer: "",
    brand: "",
    numberPrefix: "",
    numberClass: "",
    numberHiragana: "",
    numberNumeric: "",
    currentMileage: "",
    lastOilChangeMileage: "",
    oilChangeInterval: "3000",
    purchaseCost: "",
    monthlyInsurance: "",
    nextShakenDate: "",
    nextPeriodicInspectionDate: "",
    driverIds: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [openDriverPopoverVehicleId, setOpenDriverPopoverVehicleId] = useState<string | null>(null);
  const [openDetail, setOpenDetail] = useState<{
    type: "meter" | "recovery";
    vehicle: Vehicle;
  } | null>(null);
  const [recoveryTable, setRecoveryTable] = useState<{
    vehicleId: string;
    rows: { month: number; lease: number; insurance: number; collected: boolean }[];
  } | null>(null);
  const [confirmState, setConfirmState] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [errorState, setErrorState] = useState<{
    title: string;
    message: string;
    detail?: string;
  } | null>(null);
  const [numberFocused, setNumberFocused] = useState(false);

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
    setCanWrite(canAdminWrite(getStoredDriver()?.role));
    load();
  }, []);

  const openNew = () => {
    if (!canWrite) return;
    setEditingVehicle(null);
    setForm({
      manufacturer: "",
      brand: "",
      numberPrefix: "",
      numberClass: "",
      numberHiragana: "",
      numberNumeric: "",
      currentMileage: "",
      lastOilChangeMileage: "",
      oilChangeInterval: "3000",
      purchaseCost: "",
      monthlyInsurance: "",
      nextShakenDate: "",
      nextPeriodicInspectionDate: "",
      driverIds: [],
    });
    setShowModal(true);
  };

  const openEdit = (v: Vehicle) => {
    if (!canWrite) return;
    setEditingVehicle(v);
    const shaken = v.next_shaken_date;
    const periodic = v.next_periodic_inspection_date;
    setForm({
      manufacturer: v.manufacturer || "",
      brand: v.brand || "",
      numberPrefix: v.number_prefix || "",
      numberClass: v.number_class || "",
      numberHiragana: v.number_hiragana || "",
      numberNumeric: v.number_numeric || "",
      currentMileage: v.current_mileage ? String(v.current_mileage) : "",
      lastOilChangeMileage: v.last_oil_change_mileage ? String(v.last_oil_change_mileage) : "",
      oilChangeInterval: v.oil_change_interval ? String(v.oil_change_interval) : "3000",
      purchaseCost: v.purchase_cost ? String(v.purchase_cost) : "",
      monthlyInsurance: v.monthly_insurance ? String(v.monthly_insurance) : "",
      nextShakenDate: shaken && typeof shaken === "string" ? shaken.slice(0, 10) : "",
      nextPeriodicInspectionDate: periodic && typeof periodic === "string" ? periodic.slice(0, 10) : "",
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
    if (!canWrite) return;
    setSaving(true);
    try {
      const toIntOrNull = (v: string) => (v !== "" ? Number(v) : null);
      const payload = {
        manufacturer: form.manufacturer || null,
        brand: form.brand || null,
        numberPrefix: form.numberPrefix || null,
        numberClass: form.numberClass || null,
        numberHiragana: form.numberHiragana || null,
        numberNumeric: form.numberNumeric || null,
        currentMileage: toIntOrNull(form.currentMileage),
        lastOilChangeMileage: toIntOrNull(form.lastOilChangeMileage),
        oilChangeInterval: toIntOrNull(form.oilChangeInterval),
        purchaseCost: toIntOrNull(form.purchaseCost),
        monthlyInsurance: toIntOrNull(form.monthlyInsurance),
        nextShakenDate: form.nextShakenDate.trim() || null,
        nextPeriodicInspectionDate: form.nextPeriodicInspectionDate.trim() || null,
        driverIds: form.driverIds,
      };
      if (editingVehicle) {
        await apiFetch(`/api/admin/vehicles/${editingVehicle.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/api/admin/vehicles", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      setShowModal(false);
      load();
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : "";
      setErrorState({
        title: "車両の保存に失敗しました",
        message:
          "サーバーでエラーが発生したため、車両情報を保存できませんでした。\n\n" +
          "入力内容（メーカー名・ブランド名・メーター値など）に不足や不正な値がないか確認し、もう一度保存してください。\n" +
          "同じエラーが続く場合は、システム管理者に連絡してください。",
        detail: reason || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteVehicle = async (id: string, _label: string) => {
    if (!canWrite) return;
    setConfirmState({
      message: "この車両を削除しますか？",
      onConfirm: async () => {
        try {
          await apiFetch(`/api/admin/vehicles/${id}`, { method: "DELETE" });
          load();
        } catch (e) {
          console.error(e);
          const reason = e instanceof Error ? e.message : "";
          setErrorState({
            title: "車両の削除に失敗しました",
            message:
              "サーバーでエラーが発生したため、この車両を削除できませんでした。\n\n" +
              "時間をおいて再度お試しください。それでも解決しない場合は、この車両に紐付くデータ（シフト・日報など）が原因の可能性があるため、システム管理者に連絡してください。",
            detail: reason || undefined,
          });
        }
      },
    });
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

  // 日付文字列（YYYY-MM-DD）を「YYYY年M月」で表示。空なら「未設定」
  const formatInspectionDate = (d: string | null | undefined): string => {
    if (!d || typeof d !== "string") return "未設定";
    const s = d.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "未設定";
    const y = s.slice(0, 4);
    const m = Number(s.slice(5, 7));
    return `${y}年${m}月`;
  };

  const openMeterDetail = (v: Vehicle) => {
    setOpenDetail({ type: "meter", vehicle: v });
  };

  const openRecoveryDetail = (v: Vehicle) => {
    const baseLease = LEASE_COST;
    const baseInsurance = v.monthly_insurance || 0;
    const rows = Array.from({ length: 12 }, (_v, i) => ({
      month: i + 1,
      lease: baseLease,
      insurance: baseInsurance,
      collected: false,
    }));
    setRecoveryTable({ vehicleId: v.id, rows });
    setOpenDetail({ type: "recovery", vehicle: v });
  };

  return (
    <AdminLayout>
      <div className="w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">車両管理</h1>
          {canWrite && (
            <button
              onClick={openNew}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
            >
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              新規追加
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-lg border border-slate-200 p-6">
                <div className="flex gap-8">
                  <div className="flex-shrink-0 w-64 space-y-4">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-6 w-20" />
                      <Skeleton className="h-5 w-16" />
                    </div>
                    <Skeleton className="rounded-lg w-48 h-24" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {[...Array(6)].map((_, j) => (
                      <div key={j}>
                        <Skeleton className="h-3 w-20 mb-1" />
                        <Skeleton className="h-5 w-16" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
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
                <div key={v.id} className="bg-white rounded-lg border border-slate-200 p-8 shadow-sm relative">
                  {/* カード上部1行: No. / 車種 / ドライバー / 次回車検・定期点検 / 編集 */}
                  <div className="flex flex-wrap items-center gap-4 mb-6">
                    <span className="text-m text-slate-500 font-medium shrink-0">
                      No.{String(vehicleNo).padStart(4, "0")}
                    </span>
                    {(v.manufacturer || v.brand) && (
                      <span className="text-sm shrink-0 flex gap-1 items-center pl-3">
                        {v.manufacturer && (
                          <span className="text-slate-500">{v.manufacturer}</span>
                        )}
                        {v.manufacturer && v.brand && (
                          <span className="text-slate-500 mx-0.1"> </span>
                        )}
                        {v.brand && (
                          <span className="text-lg text-slate-900 font-semibold">{v.brand}</span>
                        )}
                      </span>
                    )}

                    <div className="flex items-center gap-1.5 flex-nowrap min-w-0 h-6 pl-3">
                      {vehicleDrivers.length > 0 ? (
                        vehicleDrivers.length <= 2 ? (
                          vehicleDrivers.map((vd) => (
                            <span
                              key={vd.driver_id}
                              className="inline-flex items-center h-6 px-2 rounded text-xs font-medium bg-slate-800 text-white shrink-0"
                            >
                              {getDisplayName(vd.drivers)}
                            </span>
                          ))
                        ) : (
                          <>
                            {vehicleDrivers.slice(0, 2).map((vd) => (
                              <span
                                key={vd.driver_id}
                                className="inline-flex items-center h-6 px-2 rounded text-xs font-medium bg-slate-800 text-white shrink-0"
                              >
                                {getDisplayName(vd.drivers)}
                              </span>
                            ))}
                            <div className="relative shrink-0 h-6 flex items-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenDriverPopoverVehicleId((id) => (id === v.id ? null : v.id));
                                }}
                                title={vehicleDrivers.map((vd) => getDisplayName(vd.drivers)).join("、")}
                                className="inline-flex items-center h-6 px-2 rounded text-xs font-medium bg-slate-700 text-white hover:bg-slate-600"
                              >
                                他{vehicleDrivers.length - 2}名
                              </button>
                              {openDriverPopoverVehicleId === v.id && (
                                <>
                                  <div
                                    className="fixed inset-0 z-10"
                                    aria-hidden
                                    onClick={() => setOpenDriverPopoverVehicleId(null)}
                                  />
                                  <div className="absolute left-0 top-full mt-1 z-20 bg-slate-800 text-white text-xs rounded-lg shadow-lg py-2 px-3 w-48 max-h-[140px] overflow-y-auto">
                                    <div className="font-medium text-slate-300 mb-1.5">利用ドライバー</div>
                                    <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                                      {vehicleDrivers.map((vd) => (
                                        <li key={vd.driver_id}>{getDisplayName(vd.drivers)}</li>
                                      ))}
                                    </ul>
                                  </div>
                                </>
                              )}
                            </div>
                          </>
                        )
                      ) : (
                        <span className="inline-flex items-center h-6 px-2 rounded text-xs font-medium bg-slate-50 text-slate-400 shrink-0">未設定</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm shrink-0 pl-3">
                      <span className="text-slate-400">次回車検</span>
                      <span className="font-semibold text-lg text-slate-900">{formatInspectionDate(v.next_shaken_date)}</span>
                      <span className="text-slate-400 pl-3">次回定期点検</span>
                      <span className="font-semibold text-lg text-slate-900">{formatInspectionDate(v.next_periodic_inspection_date)}</span>
                    </div>
                    {canWrite && (
                      <button
                        onClick={() => openEdit(v)}
                        className="ml-auto text-slate-400 hover:text-slate-600 transition-colors shrink-0"
                        title="編集"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    )}
                  </div>

                  <div className="flex gap-8">
                    {/* 左側: ナンバープレート、写真 */}
                    <div className="flex-shrink-0 w-full max-w-[240px] space-y-4">
                      {/* ナンバープレート */}
                      {(v.number_prefix || v.number_hiragana || v.number_numeric) && (
                        <VehiclePlate vehicle={v} className="w-full max-w-[240px]" />
                      )}

                      {/* 車両画像プレースホルダー（16:9） */}
                      <div className="w-full aspect-video bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-sm overflow-hidden">
                        <span>車両画像</span>
                      </div>
                    </div>

                    {/* 右側: オイル交換ゲージ、初期費用回収ゲージ */}
                    <div className="flex-1 space-y-4 p-2">
                      {/* オイル交換ゲージ */}
                      <div className="pt-4 pb-10">
                        <div className="flex items-baseline justify-between pb-2">
                          <div className="text-lg font-semibold text-slate-700 leading-tight">メーター管理</div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <div>
                              現在走行距離{" "}
                              <span className="text-base font-semibold text-slate-900">
                                {fmt(v.current_mileage)} km
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => openMeterDetail(v)}
                              className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                              title="メーターの詳細を見る"
                            >
                              <FontAwesomeIcon icon={faFileLines} className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {/* ラベル行 */}
                        <div className="relative h-10 mb-1">
                          {/* 前回オイル交換（左端） */}
                          <div className="absolute left-0 top-0 text-left">
                            <div className="text-[10px] text-slate-500 leading-tight">前回オイル交換</div>
                            <div className="text-xs font-medium text-slate-800 leading-tight">{fmt(v.last_oil_change_mileage)} km</div>
                          </div>
                          {/* 次回オイル交換（右端） */}
                          <div className="absolute right-0 top-0 text-right">
                            <div className="text-[10px] text-slate-500 leading-tight">次回オイル交換</div>
                            <div className="text-xs font-medium text-slate-800 leading-tight">{fmt(nextOilChangeKm)} km</div>
                          </div>
                        </div>
                        {/* ▼ マーカー行 */}
                        <div className="relative h-3">
                          {(() => {
                            const percent = Math.min(Math.max(oilProgress, 0), 100);
                            let colorClass =
                              percent >= 95
                                ? "text-red-500"
                                : percent >= 70
                                  ? "text-yellow-400"
                                  : "text-green-600";
                            return (
                              <div
                                className={`absolute top-0 z-10 text-[10px] leading-none ${colorClass}`}
                                style={{ left: `${oilProgress}%`, transform: "translateX(-50%)" }}
                              >
                                ▼
                              </div>
                            );
                          })()}
                        </div>
                        {/* ゲージバー */}
                        <div className="relative h-2.5 bg-slate-200 rounded-full overflow-hidden">
                          {(() => {
                            const percent = Math.min(Math.max(oilProgress, 0), 100);
                            const colorClass =
                              percent >= 95
                                ? "bg-red-500"
                                : percent >= 70
                                  ? "bg-yellow-400"
                                  : "bg-green-500";
                            return (
                              <div
                                className={`absolute top-0 left-0 h-full rounded-full transition-all ${colorClass}`}
                                style={{ width: `${percent}%` }}
                              />
                            );
                          })()}
                        </div>
                      </div>

                      {/* 初期費用回収ゲージ（オイルメーターに近く・細く・ラベルはゲージ上） */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between pb-2">
                          <div className="text-lg font-semibold text-slate-700 leading-tight">初期費用回収率</div>
                          <button
                            type="button"
                            onClick={() => openRecoveryDetail(v)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-blue-200 bg-white text-slate-500 hover:bg-blue-50 hover:text-slate-800 transition-colors"
                            title="初期費用回収の詳細を見る"
                          >
                            <FontAwesomeIcon icon={faFileLines} className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>回収済み {fmt(recovered)}円</span>
                          <span>購入費用 {fmt(purchaseCost)}円</span>
                        </div>
                        <div className="relative h-6 bg-blue-50 rounded border border-blue-200 overflow-hidden">
                          <div
                            className="absolute top-0 left-0 h-full bg-blue-600 transition-all"
                            style={{ width: `${recoveryProgress}%` }}
                          />
                          <div className="absolute inset-0 flex items-center justify-end px-2">
                            {remainingMonths !== null && remainingMonths > 0 && (
                              <span className="text-[10px] font-medium text-blue-900">残り約{remainingMonths}ヶ月</span>
                            )}
                            {purchaseCost > 0 && recovered >= purchaseCost && (
                              <span className="text-[10px] font-medium text-green-700">回収完了</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
        }
      </div>

      {/* 車両編集モーダル */}
      {showModal && canWrite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">
                {editingVehicle ? "車両情報編集" : "新規車両追加"}
              </h2>

              <div className="space-y-4">
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
                      onFocus={() => setNumberFocused(true)}
                      onBlur={() => setNumberFocused(false)}
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
                          className={`w-10 h-10 flex items-center justify-center rounded-lg border-2 text-base font-bold transition-colors ${
                            c === "・"
                              ? "border-slate-200 bg-slate-50 text-slate-300"
                              : "border-slate-400 bg-white text-slate-900"
                          } ${numberFocused && i === 1 ? "border-slate-500 ring-1 ring-slate-400" : ""}`}
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
                      onChange={(e) => setForm((f) => ({ ...f, currentMileage: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">前回オイル交換時 (km)</label>
                    <input
                      type="number"
                      value={form.lastOilChangeMileage}
                      onChange={(e) => setForm((f) => ({ ...f, lastOilChangeMileage: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">交換間隔 (km)</label>
                  <input
                    type="number"
                    value={form.oilChangeInterval}
                    onChange={(e) => setForm((f) => ({ ...f, oilChangeInterval: e.target.value }))}
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
                      onChange={(e) => setForm((f) => ({ ...f, purchaseCost: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">月々保険料 (円)</label>
                    <input
                      type="number"
                      value={form.monthlyInsurance}
                      onChange={(e) => setForm((f) => ({ ...f, monthlyInsurance: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <p className="text-xs text-slate-500 mt-1">リース代35,000円から差し引きます</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">次回車検予定日</label>
                    <DatePicker
                      value={
                        form.nextShakenDate && /^\d{4}-\d{2}-\d{2}$/.test(form.nextShakenDate)
                          ? new Date(form.nextShakenDate + "T00:00:00")
                          : undefined
                      }
                      onChange={(d) =>
                        setForm((f) => ({ ...f, nextShakenDate: d ? format(d, "yyyy-MM-dd") : "" }))
                      }
                      placeholder="日付を選択"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">次回定期点検予定日</label>
                    <DatePicker
                      value={
                        form.nextPeriodicInspectionDate &&
                        /^\d{4}-\d{2}-\d{2}$/.test(form.nextPeriodicInspectionDate)
                          ? new Date(form.nextPeriodicInspectionDate + "T00:00:00")
                          : undefined
                      }
                      onChange={(d) =>
                        setForm((f) => ({
                          ...f,
                          nextPeriodicInspectionDate: d ? format(d, "yyyy-MM-dd") : "",
                        }))
                      }
                      placeholder="日付を選択"
                    />
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
                    disabled={saving || !(form.manufacturer || form.brand)}
                    className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "保存中..." : "保存"}
                  </button>
                </div>
                {editingVehicle && (
                  <div className="pt-3 border-t border-slate-200">
                    <button
                      onClick={() => {
                        const label = [editingVehicle.manufacturer, editingVehicle.brand].filter(Boolean).join(" ") || "この車両";
                        const message = `${label}を削除しますか？`;
                        const vehicleId = editingVehicle.id;
                        setConfirmState({
                          message,
                          onConfirm: async () => {
                            try {
                              await apiFetch(`/api/admin/vehicles/${vehicleId}`, { method: "DELETE" });
                              setShowModal(false);
                              setEditingVehicle(null);
                              load();
                            } catch (e) {
                              console.error(e);
                              const reason = e instanceof Error ? e.message : "";
                              setErrorState({
                                title: "車両の削除に失敗しました",
                                message:
                                  "サーバーでエラーが発生したため、この車両を削除できませんでした。\n\n" +
                                  "時間をおいて再度お試しください。それでも解決しない場合は、この車両に紐付くデータ（シフト・日報など）が原因の可能性があるため、システム管理者に連絡してください。",
                                detail: reason || undefined,
                              });
                            }
                          },
                        });
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

      {/* 詳細モーダル（メーター / 初期費用回収） */}
      {openDetail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              {openDetail.type === "meter" && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-900">メーター管理の詳細</h2>
                    <button
                      type="button"
                      onClick={() => setOpenDetail(null)}
                      className="text-slate-400 hover:text-slate-700 transition-colors text-sm"
                    >
                      閉じる
                    </button>
                  </div>
                  <div className="text-sm text-slate-700 mb-4">
                    <div className="font-medium mb-1">
                      {openDetail.vehicle.manufacturer} {openDetail.vehicle.brand}
                    </div>
                    <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
                      <tbody>
                        <tr className="bg-slate-50">
                          <th className="w-1/2 px-3 py-2 text-left font-medium text-slate-600">
                            前回オイル交換時メーター
                          </th>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">
                            {fmt(openDetail.vehicle.last_oil_change_mileage)} km
                          </td>
                        </tr>
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-600">
                            オイル交換間隔
                          </th>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">
                            {fmt(openDetail.vehicle.oil_change_interval)} km
                          </td>
                        </tr>
                        <tr className="bg-slate-50">
                          <th className="px-3 py-2 text-left font-medium text-slate-600">
                            次回オイル交換目安メーター
                          </th>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">
                            {fmt(
                              openDetail.vehicle.last_oil_change_mileage +
                                openDetail.vehicle.oil_change_interval
                            )}{" "}
                            km
                          </td>
                        </tr>
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-slate-600">
                            現在走行距離
                          </th>
                          <td className="px-3 py-2 text-right font-semibold text-slate-900">
                            {fmt(openDetail.vehicle.current_mileage)} km
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {openDetail.type === "recovery" && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-900">初期費用回収の詳細</h2>
                    <button
                      type="button"
                      onClick={() => setOpenDetail(null)}
                      className="text-slate-400 hover:text-slate-700 transition-colors text-sm"
                    >
                      閉じる
                    </button>
                  </div>
                  <div className="text-sm text-slate-700 mb-3">
                    <div className="font-medium mb-1">
                      {openDetail.vehicle.manufacturer} {openDetail.vehicle.brand}
                    </div>
                    <p className="text-xs text-slate-500">
                      リース代と保険料を月ごとに調整して、回収ペースをシミュレーションできます
                      （この表の数値は車両情報には保存されません）。
                    </p>
                  </div>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-2 py-2 text-left text-slate-600">月</th>
                          <th className="px-2 py-2 text-right text-slate-600">リース代</th>
                          <th className="px-2 py-2 text-right text-slate-600">保険料</th>
                          <th className="px-2 py-2 text-right text-slate-600">月回収額</th>
                          <th className="px-2 py-2 text-right text-slate-600">累計回収額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const table =
                            recoveryTable && recoveryTable.vehicleId === openDetail.vehicle.id
                              ? recoveryTable
                              : null;
                          if (!table) return null;
                          let cumulative = 0;
                          return table.rows.map((row, idx) => {
                            const monthlyRecovery = Math.max(row.lease - row.insurance, 0);
                            cumulative += monthlyRecovery;
                            return (
                              <tr
                                key={row.month}
                                className={`${idx % 2 === 0 ? "bg-white" : "bg-slate-50"} ${row.collected ? "opacity-75" : ""}`}
                              >
                                <td className="px-2 py-1.5 text-left text-slate-700">
                                  <label className="inline-flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={row.collected}
                                      onChange={() => {
                                        setRecoveryTable((prev) => {
                                          if (!prev || prev.vehicleId !== openDetail.vehicle.id) return prev;
                                          const rows = prev.rows.map((r, i) =>
                                            i === idx ? { ...r, collected: !r.collected } : r
                                          );
                                          return { ...prev, rows };
                                        });
                                      }}
                                      className="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                                    />
                                    {row.month}ヶ月目
                                  </label>
                                </td>
                                <td className="px-2 py-1.5 text-right align-middle">
                                  <input
                                    type="number"
                                    className="w-20 px-1 py-0.5 text-right border border-slate-200 rounded text-xs"
                                    value={row.lease}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const num = val === "" ? 0 : Number(val);
                                      setRecoveryTable((prev) => {
                                        if (!prev || prev.vehicleId !== openDetail.vehicle.id) return prev;
                                        const rows = prev.rows.map((r, i) =>
                                          i === idx ? { ...r, lease: num } : r
                                        );
                                        return { ...prev, rows };
                                      });
                                    }}
                                  />
                                </td>
                                <td className="px-2 py-1.5 text-right align-middle">
                                  <input
                                    type="number"
                                    className="w-20 px-1 py-0.5 text-right border border-slate-200 rounded text-xs"
                                    value={row.insurance}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const num = val === "" ? 0 : Number(val);
                                      setRecoveryTable((prev) => {
                                        if (!prev || prev.vehicleId !== openDetail.vehicle.id) return prev;
                                        const rows = prev.rows.map((r, i) =>
                                          i === idx ? { ...r, insurance: num } : r
                                        );
                                        return { ...prev, rows };
                                      });
                                    }}
                                  />
                                </td>
                                <td className="px-2 py-1.5 text-right text-slate-800">
                                  {fmt(monthlyRecovery)}円
                                </td>
                                <td className="px-2 py-1.5 text-right text-slate-800">
                                  {fmt(cumulative)}円
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
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
        detail={errorState?.detail}
        onClose={() => setErrorState(null)}
      />
    </AdminLayout>
  );
}
