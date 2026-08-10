"use client";

import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faFileLines,
  faTrash,
  faCircleExclamation,
  faTriangleExclamation,
  faQrcode,
  faCar,
  faChevronDown,
  faChevronUp,
  faUsers,
  faGaugeHigh,
  faMoneyBillWave,
} from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { DatePicker } from "@/lib/components/DatePicker";
import { MonthYearPicker } from "@/lib/components/MonthYearPicker";
import { Skeleton } from "@/lib/components/Skeleton";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { VehiclePlate, plateDigits } from "@/lib/components/VehiclePlate";
import { format } from "date-fns";
import { todayJST } from "@/lib/date";
import { apiFetch, getStoredDriver } from "@/lib/api";
import {
  VEHICLE_MODELS,
  VEHICLE_MANUFACTURERS,
  BODY_COLOR_PRESETS,
  resolveModelKey,
} from "@/lib/vehicleModels";
import { useAutoSave } from "@/lib/useAutoSave";
import { useApi } from "@/lib/useApi";
import { getDisplayName } from "@/lib/displayName";
import { hasCapability } from "@/lib/capabilities";
import { Button } from "@/lib/ui/button";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { VehicleRecoveryDetail } from "./VehicleRecoveryDetail";
import { ImageFocusPicker } from "./ImageFocusPicker";
import { ImageLightbox } from "@/lib/components/ImageLightbox";
import { VehicleQrModal } from "./VehicleQrModal";
import { VehicleQrBulkModal } from "./VehicleQrBulkModal";

const DEFAULT_LEASE_COST = 35000; // 月々リース代（デフォルト）

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
  is_disposed?: boolean | null;
  is_ev?: boolean | null;
  manufacturer?: string | null;
  body_color?: string | null;
  model_key?: string | null;
  brand?: string | null;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  current_mileage: number;
  last_oil_change_mileage: number;
  oil_change_interval: number;
  purchase_cost: number;
  purchase_cost_items?: Array<{ sign: "+" | "-"; label: string; amount: number }> | null;
  lease_cost?: number | null;
  monthly_insurance: number;
  image_url?: string | null;
  /** サムネイル（16:9）の表示中心。CSS object-position と同じ 0〜100(%)。 */
  image_focus_x?: number | null;
  image_focus_y?: number | null;
  next_shaken_date?: string | null;
  jibaiseki_renewal_month?: string | null; // YYYY-MM
  created_at: string;
  vehicle_drivers?: VehicleDriver[];
  /** 回収済みマーク: month -> collected_at (ISO日付文字列)。旧モデル（未使用・温存） */
  recovery_collected?: Record<number, string>;
  recovery_start_month?: string | null; // YYYY-MM-01
  recovery_carryover?: number | null;   // 繰越(移行済み)回収額
  recovered_amount?: number;            // サーバ算出（回収v2）
  remaining_amount?: number;            // サーバ算出（回収v2）
};

type MeterLog = {
  report_date: string; // YYYY-MM-DD
  meter_value: number;
  driver: Driver;
};

export default function VehiclesPage() {
  const emptyPurchaseItem = () => ({ sign: "+" as "+" | "-", label: "", amount: "" });
  const [canWrite, setCanWrite] = useState(false);
  // 原寸表示（ライトボックス）。一覧・編集モーダルの双方から開く。
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  // 利用ドライバー選択のアコーディオン（選択中は常時表示、未選択は展開で選ぶ）
  const [driverOpen, setDriverOpen] = useState(false);
  // 車両編集モーダルのタブ
  const [vehTab, setVehTab] = useState<"basic" | "work" | "cost" | "record">("basic");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [qrVehicle, setQrVehicle] = useState<Vehicle | null>(null);
  const [showBulkQr, setShowBulkQr] = useState(false);
  const [form, setForm] = useState({
    isDisposed: false,
    isEv: false,
    manufacturer: "",
    bodyColor: "",
    brand: "",
    numberPrefix: "",
    numberClass: "",
    numberHiragana: "",
    numberNumeric: "",
    currentMileage: "",
    lastOilChangeMileage: "",
    oilChangeInterval: "3000",
    purchaseCost: "",
    purchaseCostItems: [emptyPurchaseItem()],
    leaseCost: String(DEFAULT_LEASE_COST),
    monthlyInsurance: "",
    recoveryStartMonth: "",
    recoveryCarryover: "",
    imageDataUrl: "",
    imageFocusX: 50,
    imageFocusY: 50,
    nextShakenDate: "",
    jibaisekiRenewalMonth: "",
    driverIds: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [imageDragOver, setImageDragOver] = useState(false);
  const [openDriverPopoverVehicleId, setOpenDriverPopoverVehicleId] = useState<string | null>(null);
  const [openDetail, setOpenDetail] = useState<{
    type: "meter" | "recovery";
    vehicle: Vehicle;
  } | null>(null);
  const [meterTab, setMeterTab] = useState<"table" | "graph">("table");
  const [meterRange, setMeterRange] = useState<{ start: string; end: string } | null>(null);
  const [meterLogs, setMeterLogs] = useState<MeterLog[]>([]);
  const [meterLoading, setMeterLoading] = useState(false);
  const [meterError, setMeterError] = useState<string | null>(null);
  const [meterSelectedIdx, setMeterSelectedIdx] = useState<number | null>(null);
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

  const sortVehicles = (list: Vehicle[]) =>
    [...list].sort((a, b) => {
      const ma = (a.manufacturer ?? "").localeCompare(b.manufacturer ?? "", "ja");
      if (ma !== 0) return ma;
      const ba = (a.brand ?? "").localeCompare(b.brand ?? "", "ja");
      if (ba !== 0) return ba;
      return (a.id ?? "").localeCompare(b.id ?? "");
    });

  const toVehicleDrivers = (ids: string[]): VehicleDriver[] =>
    ids
      .map((id) => {
        const d = drivers.find((x) => x.id === id);
        if (!d) return null;
        return { driver_id: id, drivers: d };
      })
      .filter((x): x is VehicleDriver => x !== null);

  // SWR で vehicles + users をまとめてキャッシュし、遷移をまたいで保持する。
  // vehicles は楽観更新（作成/編集/削除）で setVehicles するため state を維持し、
  // 取得結果は同期エフェクトで流し込む。
  const { data: bundle, isInitialLoading, refresh: refreshBundle } = useApi<{
    vehicles: Vehicle[];
    drivers: Driver[];
    canViewCost: boolean;
  }>("admin/vehicles:bundle", {
    fetcher: async () => {
      const [vehiclesRes, driversRes] = await Promise.all([
        apiFetch<{ vehicles: Vehicle[]; canViewCost?: boolean }>("/api/admin/vehicles"),
        // 名簿（can_view_members）の権限が無いロールでは 403 になる。失敗しても
        // 車両一覧まで巻き込まない（使用者の割当候補が空になるだけに留める）。
        apiFetch<{ drivers: Array<Driver & { role?: string }> }>("/api/admin/users?all=1").catch(
          () => ({ drivers: [] as Array<Driver & { role?: string }> }),
        ),
      ]);
      return {
        vehicles: sortVehicles(vehiclesRes.vehicles),
        // API 側が works_as_driver=true で絞るため、role による除外はしない
        //（管理者等でもドライバー稼働中なら使用者に割当可能）。
        drivers: driversRes.drivers,
        // 金額情報の可否はサーバーの判定を正とする。
        // localStorage の capabilities はログイン時のスナップショットなので、
        // 権限を足した直後は再ログインするまで古いままになる。
        canViewCost: vehiclesRes.canViewCost === true,
      };
    },
  });

  const loading = isInitialLoading;

  useEffect(() => {
    if (!bundle) return;
    setVehicles(bundle.vehicles);
    setDrivers(bundle.drivers);
  }, [bundle]);

  useEffect(() => {
    setCanWrite(hasCapability("can_manage_vehicles"));
  }, []);

  // 金額情報（購入費用・リース代・初期費用回収）は独立 capability。
  // サーバーの判定（API の canViewCost）を正とする — localStorage の capabilities は
  // ログイン時のスナップショットで、権限追加後も再ログインするまで古いため。
  const canViewCost = bundle?.canViewCost === true;

  const defaultRangeLast30Days = () => {
    const end = todayJST();
    const base = new Date(end + "T12:00:00+09:00");
    const start = new Date(base);
    start.setDate(start.getDate() - 29);
    const startStr = start.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    return { start: startStr, end };
  };

  const fetchMeterLogs = async (vehicleId: string, range: { start: string; end: string }) => {
    setMeterLoading(true);
    setMeterError(null);
    try {
      const res = await apiFetch<{ logs: MeterLog[] }>(
        `/api/admin/vehicles/${vehicleId}/meter-logs?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`
      );
      const logs = (res.logs ?? []).filter((l) => l && typeof l.meter_value === "number");
      setMeterLogs(logs);
      setMeterSelectedIdx(logs.length ? logs.length - 1 : null);
    } catch (e) {
      console.error(e);
      setMeterError(e instanceof Error ? e.message : "取得に失敗しました");
      setMeterLogs([]);
      setMeterSelectedIdx(null);
    } finally {
      setMeterLoading(false);
    }
  };

  useEffect(() => {
    if (!openDetail || openDetail.type !== "meter") return;
    setMeterTab("table");
    const range = defaultRangeLast30Days();
    setMeterRange(range);
    setMeterLogs([]);
    setMeterSelectedIdx(null);
    fetchMeterLogs(openDetail.vehicle.id, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDetail?.type, openDetail?.vehicle?.id]);

  const openNew = () => {
    if (!canWrite) return;
    setEditingVehicle(null);
    setForm({
      isDisposed: false,
      isEv: false,
      manufacturer: "",
      bodyColor: "",
      brand: "",
      numberPrefix: "",
      numberClass: "",
      numberHiragana: "",
      numberNumeric: "",
      currentMileage: "",
      lastOilChangeMileage: "",
      oilChangeInterval: "3000",
      purchaseCost: "",
      purchaseCostItems: [emptyPurchaseItem()],
      leaseCost: String(DEFAULT_LEASE_COST),
      monthlyInsurance: "",
      recoveryStartMonth: "",
      recoveryCarryover: "",
      imageDataUrl: "",
      imageFocusX: 50,
      imageFocusY: 50,
      nextShakenDate: "",
      jibaisekiRenewalMonth: "",
      driverIds: [],
    });
    setVehTab("basic");
    setDriverOpen(false);
    setShowModal(true);
  };

  const openEdit = (v: Vehicle) => {
    if (!canWrite) return;
    setEditingVehicle(v);
    const shaken = v.next_shaken_date;
    const rawItems = Array.isArray(v.purchase_cost_items) ? v.purchase_cost_items : [];
    const mappedItems: Array<{ sign: "+" | "-"; label: string; amount: string }> =
      rawItems.length > 0
        ? rawItems.map((it) => ({
            sign: (it?.sign === "-" ? "-" : "+") as "+" | "-",
            label: String(it?.label ?? ""),
            amount: String(Number(it?.amount) || 0),
          }))
        : [{ sign: "+", label: "初期費用", amount: String(v.purchase_cost || 0) }];
    setForm({
      isDisposed: !!v.is_disposed,
      isEv: !!v.is_ev,
      manufacturer: v.manufacturer || "",
      bodyColor: v.body_color || "",
      brand: v.brand || "",
      numberPrefix: v.number_prefix || "",
      numberClass: v.number_class || "",
      numberHiragana: v.number_hiragana || "",
      numberNumeric: v.number_numeric || "",
      currentMileage: v.current_mileage ? String(v.current_mileage) : "",
      lastOilChangeMileage: v.last_oil_change_mileage ? String(v.last_oil_change_mileage) : "",
      oilChangeInterval: v.oil_change_interval ? String(v.oil_change_interval) : "3000",
      purchaseCost: v.purchase_cost ? String(v.purchase_cost) : "",
      purchaseCostItems: mappedItems,
      leaseCost:
        v.lease_cost != null && Number.isFinite(Number(v.lease_cost))
          ? String(v.lease_cost)
          : String(DEFAULT_LEASE_COST),
      monthlyInsurance: v.monthly_insurance ? String(v.monthly_insurance) : "",
      recoveryStartMonth:
        v.recovery_start_month && /^\d{4}-\d{2}/.test(String(v.recovery_start_month))
          ? String(v.recovery_start_month).slice(0, 7)
          : "",
      recoveryCarryover: v.recovery_carryover != null ? String(v.recovery_carryover) : "",
      imageDataUrl: v.image_url || "",
      imageFocusX: v.image_focus_x ?? 50,
      imageFocusY: v.image_focus_y ?? 50,
      nextShakenDate: shaken && typeof shaken === "string" ? shaken.slice(0, 10) : "",
      jibaisekiRenewalMonth:
        v.jibaiseki_renewal_month && /^\d{4}-\d{2}$/.test(v.jibaiseki_renewal_month)
          ? v.jibaiseki_renewal_month
          : "",
      driverIds: v.vehicle_drivers?.map((vd) => vd.driver_id) || [],
    });
    setVehTab("basic");
    setDriverOpen(false);
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

  /**
   * 車両の保存本体。閉じる操作から切り離してあり、編集時は自動保存からも呼ぶ。
   * ※車両画像は data URL（数MB）なので、未変更なら payload から外している（下の imageUnchanged）。
   */
  const save = async () => {
    if (!canWrite) return;
    setSaving(true);
    try {
      const toIntOrNull = (v: string) => (v !== "" ? Number(v) : null);
      const normalizedItems: Array<{ sign: "+" | "-"; label: string; amount: number }> = form.purchaseCostItems
        .map((it) => ({
          sign: (it.sign === "-" ? "-" : "+") as "+" | "-",
          label: String(it.label ?? "").trim(),
          amount: Number(String(it.amount ?? "").replace(/[^\d]/g, "")) || 0,
        }))
        .filter((it) => it.label || it.amount > 0);
      const computedPurchaseCost = Math.max(
        0,
        normalizedItems.reduce((sum, it) => sum + (it.sign === "-" ? -it.amount : it.amount), 0),
      );
      // 車両画像は data URL（base64）で保存しているため、1枚で数MBになる。
      // 変更していないのに毎回送ると保存が目に見えて遅くなるので、
      // 元の値と同じなら payload から外す（PUT 側は undefined の項目をスキップする）。
      const imageUnchanged =
        editingVehicle != null && (form.imageDataUrl.trim() || null) === (editingVehicle.image_url ?? null);

      const payload = {
        isDisposed: form.isDisposed,
        isEv: form.isEv,
        manufacturer: form.manufacturer || null,
        // 地図の3Dモデルはメーカー・車種名から自動で決める（表に無ければ既定モデル）
        modelKey: resolveModelKey(form.manufacturer, form.brand),
        bodyColor: form.bodyColor || null,
        brand: form.brand || null,
        numberPrefix: form.numberPrefix || null,
        numberClass: form.numberClass || null,
        numberHiragana: form.numberHiragana || null,
        numberNumeric: form.numberNumeric || null,
        currentMileage: toIntOrNull(form.currentMileage),
        lastOilChangeMileage: toIntOrNull(form.lastOilChangeMileage),
        oilChangeInterval: toIntOrNull(form.oilChangeInterval),
        purchaseCost: computedPurchaseCost,
        purchaseCostItems: normalizedItems,
        leaseCost: toIntOrNull(form.leaseCost) ?? DEFAULT_LEASE_COST,
        monthlyInsurance: toIntOrNull(form.monthlyInsurance),
        recoveryStartMonth: form.recoveryStartMonth.trim() || null,
        recoveryCarryover: toIntOrNull(form.recoveryCarryover) ?? 0,
        ...(imageUnchanged ? {} : { imageUrl: form.imageDataUrl.trim() || null }),
        // 表示位置は軽い数値なので常に送る（画像を差し替えなくても調整できる）
        imageFocusX: form.imageFocusX,
        imageFocusY: form.imageFocusY,
        nextShakenDate: form.nextShakenDate.trim() || null,
        jibaisekiRenewalMonth: form.jibaisekiRenewalMonth.trim() || null,
        driverIds: form.driverIds,
      };
      // 廃車でもナンバーは保持する（一覧では斜線表示で廃車を示す）。
      if (editingVehicle) {
        await apiFetch(`/api/admin/vehicles/${editingVehicle.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        const updatedVehicle: Vehicle = {
          ...editingVehicle,
          is_disposed: form.isDisposed,
          manufacturer: payload.manufacturer,
          brand: payload.brand,
          number_prefix: payload.numberPrefix,
          number_class: payload.numberClass,
          number_hiragana: payload.numberHiragana,
          number_numeric: payload.numberNumeric,
          current_mileage: payload.currentMileage ?? 0,
          last_oil_change_mileage: payload.lastOilChangeMileage ?? 0,
          oil_change_interval: payload.oilChangeInterval ?? 3000,
          purchase_cost: computedPurchaseCost,
          purchase_cost_items: normalizedItems,
          lease_cost: payload.leaseCost ?? DEFAULT_LEASE_COST,
          monthly_insurance: payload.monthlyInsurance ?? 0,
          // 未変更のときは payload に含めていないので、元の値を保つ
          image_url: imageUnchanged ? editingVehicle.image_url : form.imageDataUrl.trim() || null,
          image_focus_x: form.imageFocusX,
          image_focus_y: form.imageFocusY,
          next_shaken_date: payload.nextShakenDate,
          jibaiseki_renewal_month: payload.jibaisekiRenewalMonth,
          vehicle_drivers: toVehicleDrivers(payload.driverIds ?? []),
        };
        setVehicles((prev) => sortVehicles(prev.map((v) => (v.id === editingVehicle.id ? updatedVehicle : v))));
      } else {
        const res = await apiFetch<{ vehicle: Vehicle }>("/api/admin/vehicles", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setVehicles((prev) => sortVehicles([...prev, res.vehicle]));
      }
      if (!editingVehicle) setShowModal(false); // 新規追加は保存で閉じる（編集は自動保存＋閉じるボタン）
      // ここまでで保存は確定（成否はレスポンスで判明済み）。
      // 再取得はバックグラウンドに回して待たない — 画面は楽観更新で既に最新のため、
      // ここで await すると「保存中」表示が無駄に長引く。
      // ただしキャッシュ更新自体は必須（怠ると他ページから戻ったとき
      // 古いキャッシュで上書きされ「保存されていない」ように見える）。
      void refreshBundle();
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

  const readImageFileAsDataUrl = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (url) setForm((f) => ({ ...f, imageDataUrl: url }));
    };
    reader.readAsDataURL(file);
  };

  // 編集中の車両だけ自動保存する（新規追加は「保存」で確定）。
  // 画像は未変更なら payload に載らないので、入力途中の保存でも数MBを送り直すことはない。
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  saveRef.current = save;
  const { status: autoSave, flush: flushAutoSave } = useAutoSave({
    value: form,
    enabled: showModal && !!editingVehicle && canWrite && !!(form.manufacturer || form.brand),
    delay: 1500, // 入力項目が多く payload も大きいので、ドライバー編集より長めにする
    resetKey: editingVehicle?.id ?? null,
    onSave: async () => {
      await saveRef.current?.();
    },
  });

  const deleteVehicle = async (id: string, _label: string) => {
    if (!canWrite) return;
    setConfirmState({
      message: "この車両を削除しますか？",
      onConfirm: async () => {
        try {
          await apiFetch(`/api/admin/vehicles/${id}`, { method: "DELETE" });
          setVehicles((prev) => prev.filter((v) => v.id !== id));
          void refreshBundle(); // 再取得は待たない（上と同じ理由）
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
    const lease = v.lease_cost ?? DEFAULT_LEASE_COST;
    return lease - (v.monthly_insurance || 0);
  };

  // 回収済み金額（回収v2: サーバ算出。繰越＋自動カレンダー月＋日額自動＋手動行）
  const getRecoveredAmount = (v: Vehicle) => {
    return v.recovered_amount ?? 0;
  };

  // 回収まで残り月数（残額 ÷ 月々回収レート）
  const getRemainingMonths = (v: Vehicle) => {
    const remaining = v.remaining_amount ?? Math.max((v.purchase_cost || 0) - getRecoveredAmount(v), 0);
    const monthly = getMonthlyRecovery(v);
    if (monthly <= 0) return null;
    return Math.ceil(remaining / monthly);
  };

  const fmt = (n: number) => n.toLocaleString("ja-JP");

  const fmtSigned = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `-${fmt(Math.abs(n))}` : "0");

  const toDateObj = (iso: string) => {
    if (!iso || typeof iso !== "string") return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
    return new Date(iso + "T00:00:00+09:00");
  };

  const meterRows = (() => {
    // logs are already ascending by date
    const rows = meterLogs.map((l, idx) => {
      const prev = idx > 0 ? meterLogs[idx - 1] : null;
      const delta = prev ? l.meter_value - prev.meter_value : null;
      return { ...l, delta };
    });
    return rows;
  })();

  // 日付文字列（YYYY-MM-DD）を「YYYY年M月」で表示。空なら「未設定」
  const formatInspectionDate = (d: string | null | undefined): string => {
    if (!d || typeof d !== "string") return "未設定";
    const s = d.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "未設定";
    const y = s.slice(0, 4);
    const m = Number(s.slice(5, 7));
    return `${y}年${m}月`;
  };

  // 月（YYYY-MM）を「YYYY年M月」で表示。空なら「未設定」
  const formatMonth = (m: string | null | undefined): string => {
    if (!m || typeof m !== "string") return "未設定";
    if (!/^\d{4}-\d{2}$/.test(m)) return "未設定";
    const y = m.slice(0, 4);
    const mm = Number(m.slice(5, 7));
    return `${y}年${mm}月`;
  };

  const openMeterDetail = (v: Vehicle) => {
    setOpenDetail({ type: "meter", vehicle: v });
  };

  const openRecoveryDetail = (v: Vehicle) => {
    setOpenDetail({ type: "recovery", vehicle: v });
  };

  // 回収詳細で recovered/remaining が変わったら一覧へ同期（手動行の追加/削除時）
  const syncRecovered = (vehicleId: string, recovered: number, remaining: number) => {
    setVehicles((prev) =>
      prev.map((veh) =>
        veh.id === vehicleId ? { ...veh, recovered_amount: recovered, remaining_amount: remaining } : veh,
      ),
    );
  };

  // オイル交換の警告対象（廃車・EV・間隔未設定は除外）。バナー集計に使用。
  const oilAlertVehicles = vehicles.filter(
    (v) => !v.is_disposed && !v.is_ev && v.oil_change_interval > 0,
  );
  const oilCriticalCount = oilAlertVehicles.filter((v) => getOilRemainingKm(v) < 100).length;
  const oilWarnCount = oilAlertVehicles.filter((v) => {
    const r = getOilRemainingKm(v);
    return r >= 100 && r <= 300;
  }).length;
  const oilAlertTotal = oilCriticalCount + oilWarnCount;

  // 元の配列順に基づく安定したナンバーを割り当て（廃車も含めて変動しない）
  const vehicleNoMap = new Map<string, number>(
    vehicles.map((v, i) => [v.id, i + 1] as const),
  );
  const orderedVehicles = [...vehicles].sort((a, b) => {
    const aDisposed = !!a.is_disposed;
    const bDisposed = !!b.is_disposed;
    if (aDisposed !== bDisposed) return aDisposed ? 1 : -1;
    return 0;
  });

  return (
    <AdminLayout>
      <div className="w-full">
        {/* 見出しとオイル警告は追従させる。貼り付き位置は AdminLayout が実測して公開する
            モバイルヘッダー高さ（PC は 0）に合わせる */}
        <div
          className="sticky z-30 -mx-3 px-3 md:-mx-6 md:px-6 bg-slate-50 pt-2 -mt-1 border-b border-slate-200/80"
          style={{ top: "var(--admin-header-h, 0px)" }}
        >
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <FontAwesomeIcon icon={faCar} className="w-5 h-5 text-slate-400" />
            車両管理
          </h1>
          {canWrite && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="default" onClick={() => setShowBulkQr(true)}>
                <FontAwesomeIcon icon={faQrcode} className="w-3.5 h-3.5" />
                QR一括
              </Button>
              <Button variant="default" size="default" onClick={openNew}>
                <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
                新規追加
              </Button>
            </div>
          )}
        </div>

        {/* オイル交換の警告サマリー（要交換・接近の台数を上部に強調表示） */}
        {!loading && oilAlertTotal > 0 && (
          <div
            className={`mb-4 rounded-xl border p-3 md:p-4 ${
              oilCriticalCount > 0 ? "border-rose-300 bg-rose-50" : "border-amber-300 bg-amber-50"
            }`}
          >
            <div className="flex items-start gap-3">
              <FontAwesomeIcon
                icon={oilCriticalCount > 0 ? faCircleExclamation : faTriangleExclamation}
                className={`mt-0.5 h-5 w-5 shrink-0 ${oilCriticalCount > 0 ? "text-rose-500" : "text-amber-500"}`}
              />
              <div className="min-w-0">
                <p className={`text-sm font-bold ${oilCriticalCount > 0 ? "text-rose-800" : "text-amber-800"}`}>
                  オイル交換が迫っている車両が {oilAlertTotal} 台あります
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {oilCriticalCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-2.5 py-0.5 text-xs font-bold text-white">
                      <FontAwesomeIcon icon={faCircleExclamation} className="h-3 w-3" />
                      要交換 {oilCriticalCount} 台
                    </span>
                  )}
                  {oilWarnCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-white">
                      <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3" />
                      交換時期接近 {oilWarnCount} 台
                    </span>
                  )}
                </div>
                <p className={`mt-1.5 hidden md:block text-xs ${oilCriticalCount > 0 ? "text-rose-700" : "text-amber-700"}`}>
                  各車両のオイルゲージを確認し、交換手配を進めてください。
                </p>
              </div>
            </div>
          </div>
        )}
        </div>

        {loading ? (
          // 実カードと同じ骨格（上部1行＋左:プレート/写真・右:ゲージ2本）。
          // スマホは左側が横並び、PC は縦積みという実表示の分岐もそのまま再現する。
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 md:p-8 shadow-sm">
                {/* 上部1行: No. / 車種 / ドライバー / 次回車検・自賠責 / 操作 */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 md:gap-4 mb-4 md:mb-6">
                  <Skeleton className="h-4 w-16 shrink-0" />
                  <Skeleton className="h-4 w-28 shrink-0" />
                  <Skeleton className="h-5 md:h-6 w-20 rounded shrink-0" />
                  <Skeleton className="h-4 w-24 shrink-0" />
                  <Skeleton className="h-4 w-24 shrink-0" />
                  {canWrite && (
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                      <Skeleton className="h-5 w-5 rounded" />
                      <Skeleton className="h-5 w-5 rounded" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col md:flex-row gap-5 md:gap-8">
                  {/* 左: ナンバープレート＋車両画像（スマホは横並び） */}
                  <div className="flex-shrink-0 w-full md:max-w-[240px] flex flex-row md:flex-col items-start gap-3 md:gap-4">
                    <Skeleton className="w-1/2 md:w-full aspect-[2/1] rounded-lg shrink-0" />
                    <Skeleton className="min-w-0 flex-1 md:w-full aspect-video rounded-lg" />
                  </div>
                  {/* 右: オイル交換／初期費用回収のゲージ2本 */}
                  <div className="flex-1 space-y-4 p-2">
                    {[0, 1].map((g) => (
                      <div key={g} className="pt-4 pb-10">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pb-2">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-4 w-24" />
                        </div>
                        <Skeleton className="h-3 w-full rounded-full" />
                        <div className="flex justify-between pt-2">
                          <Skeleton className="h-3 w-20" />
                          <Skeleton className="h-3 w-20" />
                        </div>
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
            {orderedVehicles.map((v, idx) => {
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

              const vehicleNo = vehicleNoMap.get(v.id) ?? idx + 1;

              return (
                <div
                  key={v.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, a, input, [role="switch"]')) return;
                    if (canWrite) openEdit(v);
                  }}
                  role={canWrite ? "button" : undefined}
                  className={`soft-rise rounded-lg border p-4 sm:p-6 md:p-8 shadow-sm relative ${canWrite ? "cursor-pointer hover:border-slate-300 transition-colors" : ""} ${
                    v.is_disposed
                      ? "bg-red-50 border-red-200"
                      : "bg-white border-slate-200"
                  }`}
                >
                  {/* カード上部1行: No. / 車種 / ドライバー / 次回車検・自賠責 / 編集
                      （スマホでも詰めて並ぶよう、文字を小さめ・間隔を狭めにしている） */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 md:gap-4 mb-4 md:mb-6">
                    <span className={`text-xs md:text-base font-medium shrink-0 ${v.is_disposed ? "text-red-700" : "text-slate-500"}`}>
                      No.{String(vehicleNo).padStart(4, "0")}
                    </span>
                    {v.is_disposed && (
                      <span className="inline-flex items-center h-6 px-2 rounded text-xs font-semibold bg-red-600 text-white shrink-0">
                        廃車
                      </span>
                    )}
                    {!v.is_disposed && v.oil_change_interval > 0 && oilRemaining < 100 && (
                      <span className="inline-flex items-center gap-1 h-6 px-2 rounded text-xs font-semibold bg-red-600 text-white shrink-0">
                        <FontAwesomeIcon icon={faCircleExclamation} className="w-3 h-3" />
                        オイル要交換{oilRemaining < 0 ? `（${fmt(Math.abs(oilRemaining))}km超過）` : ""}
                      </span>
                    )}
                    {!v.is_disposed && v.oil_change_interval > 0 && oilRemaining >= 100 && oilRemaining <= 300 && (
                      <span className="inline-flex items-center gap-1 h-6 px-2 rounded text-xs font-semibold bg-yellow-100 text-yellow-800 border border-yellow-300 shrink-0">
                        <FontAwesomeIcon icon={faTriangleExclamation} className="w-3 h-3" />
                        オイル接近（残り{fmt(oilRemaining)}km）
                      </span>
                    )}
                    {(v.manufacturer || v.brand) && (
                      <span className="text-xs md:text-sm shrink-0 flex gap-1 items-center md:pl-3">
                        {v.manufacturer && (
                          <span className="text-slate-500">{v.manufacturer}</span>
                        )}
                        {v.manufacturer && v.brand && (
                          <span className="text-slate-500 mx-0.1"> </span>
                        )}
                        {v.brand && (
                          <span className="text-sm md:text-lg text-slate-900 font-semibold">{v.brand}</span>
                        )}
                      </span>
                    )}

                    <div className="flex items-center gap-1 md:gap-1.5 flex-nowrap min-w-0 h-6 md:pl-3">
                      {vehicleDrivers.length > 0 ? (
                        vehicleDrivers.length <= 2 ? (
                          vehicleDrivers.map((vd) => (
                            <span
                              key={vd.driver_id}
                              className="inline-flex items-center h-5 md:h-6 px-1.5 md:px-2 rounded text-[11px] md:text-xs font-medium bg-slate-800 text-white shrink-0"
                            >
                              {getDisplayName(vd.drivers)}
                            </span>
                          ))
                        ) : (
                          <>
                            {vehicleDrivers.slice(0, 2).map((vd) => (
                              <span
                                key={vd.driver_id}
                                className="inline-flex items-center h-5 md:h-6 px-1.5 md:px-2 rounded text-[11px] md:text-xs font-medium bg-slate-800 text-white shrink-0"
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
                                className="inline-flex items-center h-5 md:h-6 px-1.5 md:px-2 rounded text-[11px] md:text-xs font-medium bg-slate-700 text-white hover:bg-slate-600"
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
                        <span className="inline-flex items-center h-5 md:h-6 px-1.5 md:px-2 rounded text-[11px] md:text-xs font-medium bg-slate-50 text-slate-400 shrink-0">未設定</span>
                      )}
                    </div>
                    {/* 車検・自賠責はスマホでも1行に収まるよう小さめに（PC は従来サイズ） */}
                    <div className="flex flex-wrap items-baseline gap-x-2.5 md:gap-x-4 gap-y-1 text-[11px] md:text-sm min-w-0 md:pl-3">
                      <span className="inline-flex items-baseline gap-1 md:gap-1.5 whitespace-nowrap">
                        <span className="text-slate-400">次回車検</span>
                        <span className="font-semibold text-xs md:text-lg text-slate-900">{formatInspectionDate(v.next_shaken_date)}</span>
                      </span>
                      <span className="inline-flex items-baseline gap-1 md:gap-1.5 whitespace-nowrap">
                        <span className="text-slate-400">自賠責更新</span>
                        <span className="font-semibold text-xs md:text-lg text-slate-900">{formatMonth(v.jibaiseki_renewal_month)}</span>
                      </span>
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
                    {canWrite && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setQrVehicle(v);
                        }}
                        className="text-slate-400 hover:text-slate-600 transition-colors shrink-0"
                        title="車両QR"
                      >
                        <FontAwesomeIcon icon={faQrcode} className="w-5 h-5" />
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col md:flex-row gap-5 md:gap-8">
                    {/* 左側: ナンバープレート、写真。スマホは横並び（縦の消費を半分に） */}
                    <div className="flex-shrink-0 w-full md:max-w-[240px] flex flex-row md:flex-col items-start gap-3 md:gap-4 md:space-y-0">
                      {/* ナンバープレート */}
                      {(v.number_prefix || v.number_hiragana || v.number_numeric) && (
                        <div className="relative w-1/2 md:w-full max-w-[240px] shrink-0">
                          <VehiclePlate vehicle={v} className="w-full md:max-w-[240px]" />
                          {v.is_disposed && (
                            <svg
                              className="absolute inset-0 w-full h-full pointer-events-none"
                              viewBox="0 0 100 100"
                              preserveAspectRatio="none"
                              aria-hidden
                            >
                              <line
                                x1="2"
                                y1="2"
                                x2="98"
                                y2="98"
                                stroke="#dc2626"
                                strokeWidth="3"
                                strokeLinecap="round"
                                vectorEffect="non-scaling-stroke"
                              />
                            </svg>
                          )}
                        </div>
                      )}

                      {/* 車両画像プレースホルダー（16:9） */}
                      <div className="min-w-0 flex-1 md:w-full aspect-video bg-slate-100 rounded-lg overflow-hidden">
                        {v.image_url ? (
                          // タップ/クリックで原寸表示。カード自体のクリック（編集）とは分ける。
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightboxSrc(v.image_url ?? null);
                            }}
                            className="block h-full w-full cursor-zoom-in"
                            title="タップで拡大"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={v.image_url}
                              alt="車両画像"
                              className="w-full h-full object-cover"
                              style={{
                                objectPosition: `${v.image_focus_x ?? 50}% ${v.image_focus_y ?? 50}%`,
                              }}
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          </button>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
                            <span>車両画像</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 右側: オイル交換ゲージ、初期費用回収ゲージ */}
                    <div className="flex-1 space-y-4 p-2">
                      {/* オイル交換ゲージ */}
                      <div className="pt-4 pb-10">
                        {/* 狭い画面では「現在走行距離…」のまとまりごと次行へ折り返す（語中で割らない） */}
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pb-2">
                          <div className="text-lg font-semibold text-slate-700 leading-tight">メーター管理</div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <div className="whitespace-nowrap">
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
                            <div
                              className={`text-xs font-medium leading-tight ${
                                v.oil_change_interval > 0 && oilRemaining < 100
                                  ? "text-red-600"
                                  : v.oil_change_interval > 0 && oilRemaining <= 300
                                    ? "text-yellow-700"
                                    : "text-slate-800"
                              }`}
                            >
                              {fmt(nextOilChangeKm)} km
                            </div>
                          </div>
                        </div>
                        {/* ▼ マーカー行 */}
                        <div className="relative h-3">
                          {(() => {
                            const percent = Math.min(Math.max(oilProgress, 0), 100);
                            const colorClass =
                              oilRemaining < 100
                                ? "text-red-500"
                                : oilRemaining <= 300
                                  ? "text-yellow-400"
                                  : "text-green-600";
                            return (
                              <div
                                className={`absolute top-0 z-10 text-[10px] leading-none ${colorClass}`}
                                style={{ left: `${percent}%`, transform: "translateX(-50%)" }}
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
                              oilRemaining < 100
                                ? "bg-red-500"
                                : oilRemaining <= 300
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
                        {/* 残り距離の表示 */}
                        {v.oil_change_interval > 0 && (
                          <div className="mt-2 text-right text-xs">
                            {oilRemaining < 0 ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-red-600">
                                <FontAwesomeIcon icon={faCircleExclamation} className="w-3.5 h-3.5" />
                                オイル交換期限を {fmt(Math.abs(oilRemaining))} km 超過
                              </span>
                            ) : oilRemaining < 100 ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-red-600">
                                <FontAwesomeIcon icon={faCircleExclamation} className="w-3.5 h-3.5" />
                                残り {fmt(oilRemaining)} km（要交換）
                              </span>
                            ) : oilRemaining <= 300 ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-yellow-700">
                                <FontAwesomeIcon icon={faTriangleExclamation} className="w-3.5 h-3.5" />
                                残り {fmt(oilRemaining)} km（交換時期接近）
                              </span>
                            ) : (
                              <span className="text-slate-500">
                                残り {fmt(oilRemaining)} km
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 初期費用回収ゲージ（オイルメーターに近く・細く・ラベルはゲージ上）
                          金額情報は can_view_vehicle_cost 保持者のみ。 */}
                      {canViewCost && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between pb-2">
                          <div className="text-lg font-semibold text-slate-700 leading-tight">初期費用回収率</div>
                          <button
                            type="button"
                            onClick={() => openRecoveryDetail(v)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-amber-200 bg-white text-slate-500 hover:bg-amber-50 hover:text-slate-800 transition-colors"
                            title="初期費用回収の詳細を見る"
                          >
                            <FontAwesomeIcon icon={faFileLines} className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-500">
                          <span>回収済み {fmt(recovered)}円</span>
                          <span>購入費用 {fmt(purchaseCost)}円</span>
                        </div>
                        <div className="relative h-6 bg-amber-50 rounded border border-amber-200 overflow-hidden">
                          <div
                            className="absolute top-0 left-0 h-full bg-amber-600 transition-all"
                            style={{ width: `${recoveryProgress}%` }}
                          />
                          <div className="absolute inset-0 flex items-center justify-end px-2">
                            {remainingMonths !== null && remainingMonths > 0 && (
                              <span className="text-[10px] font-medium text-amber-900">残り約{remainingMonths}ヶ月</span>
                            )}
                            {purchaseCost > 0 && recovered >= purchaseCost && (
                              <span className="text-[10px] font-medium text-green-700">回収完了</span>
                            )}
                          </div>
                        </div>
                      </div>
                      )}
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
        <div className="modal-backdrop-in fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { flushAutoSave(); setShowModal(false); }}>
          <div className="modal-panel-in bg-white rounded-lg shadow-lg w-full max-w-2xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 flex flex-col min-h-0 flex-1">
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  {editingVehicle ? "車両情報編集" : "新規車両追加"}
                </h2>
                {editingVehicle && (
                  <div className="flex items-center gap-1">
                    <button type="button" title="走行距離" onClick={() => { setShowModal(false); setOpenDetail({ type: "meter", vehicle: editingVehicle }); }}
                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors">
                      <FontAwesomeIcon icon={faGaugeHigh} className="w-4 h-4" />
                    </button>
                    {canViewCost && (
                      <button type="button" title="回収状況" onClick={() => { setShowModal(false); setOpenDetail({ type: "recovery", vehicle: editingVehicle }); }}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors">
                        <FontAwesomeIcon icon={faMoneyBillWave} className="w-4 h-4" />
                      </button>
                    )}
                    <button type="button" title="車両QR" onClick={() => { setShowModal(false); setQrVehicle(editingVehicle); }}
                      className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors">
                      <FontAwesomeIcon icon={faQrcode} className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* タブ */}
              <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
                {([["basic", "基本", faCar], ["work", "稼働", faUsers], ["cost", "費用", faMoneyBillWave], ["record", "記録", faFileLines]] as const)
                  // 金額情報の権限が無ければ「費用」タブごと出さない
                  .filter(([key]) => key !== "cost" || canViewCost)
                  .map(([key, label, icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setVehTab(key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${vehTab === key ? "border-amber-500 text-amber-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
                  >
                    <FontAwesomeIcon icon={icon} className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
                {vehTab === "basic" && (
                <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">メーカー名</label>
                    <input
                      type="text"
                      value={form.manufacturer}
                      onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))}
                      placeholder="例: スズキ"
                      list="vehicle-manufacturers"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    {/* 選択式だが自由記入もできる（datalist）。表に無い車も登録できることを優先する */}
                    <datalist id="vehicle-manufacturers">
                      {VEHICLE_MANUFACTURERS.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">ブランド名</label>
                    <input
                      type="text"
                      value={form.brand}
                      onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                      placeholder="例: エブリイ"
                      list="vehicle-brands"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <datalist id="vehicle-brands">
                      {VEHICLE_MODELS.map((m) => (
                        <option key={m.key} value={m.brand}>
                          {m.manufacturer}
                        </option>
                      ))}
                    </datalist>
                    {/* 地図で使う3Dモデルは車種名から自動で決まる。何が使われるかを明示する */}
                    <p className="mt-1 text-[11px] text-slate-400">
                      {resolveModelKey(form.manufacturer, form.brand)
                        ? `地図では ${form.brand} の3Dモデルで表示されます`
                        : "この車種の3Dモデルはまだ無いため、地図では標準の軽バンで表示されます"}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">車体色（地図の表示）</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {BODY_COLOR_PRESETS.map((c) => {
                        const active = form.bodyColor.toLowerCase() === c.value.toLowerCase();
                        return (
                          <button
                            key={c.value}
                            type="button"
                            title={c.label}
                            onClick={() => setForm((f) => ({ ...f, bodyColor: active ? "" : c.value }))}
                            className={`h-7 w-7 rounded-full border-2 transition-transform ${
                              active ? "scale-110 border-slate-900" : "border-slate-200 hover:scale-105"
                            }`}
                            style={{ backgroundColor: c.value }}
                          />
                        );
                      })}
                      <input
                        type="color"
                        value={form.bodyColor || "#f1f5f9"}
                        onChange={(e) => setForm((f) => ({ ...f, bodyColor: e.target.value }))}
                        className="h-7 w-9 cursor-pointer rounded border border-slate-200 bg-white"
                        aria-label="車体色を選ぶ"
                      />
                      {form.bodyColor && (
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, bodyColor: "" }))}
                          className="text-[11px] text-slate-400 hover:text-slate-600"
                        >
                          未設定に戻す
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">ナンバープレート</label>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <input
                      type="text"
                      value={form.numberPrefix}
                      onChange={(e) => setForm((f) => ({ ...f, numberPrefix: e.target.value }))}
                      placeholder="地域名（例: 京都）"
                      className="px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                    <input
                      type="text"
                      value={form.numberClass}
                      onChange={(e) => setForm((f) => ({ ...f, numberClass: e.target.value }))}
                      placeholder="分類（例: 400）"
                      className="px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                    <input
                      type="text"
                      value={form.numberHiragana}
                      onChange={(e) => setForm((f) => ({ ...f, numberHiragana: e.target.value }))}
                      placeholder="かな（例: わ）"
                      maxLength={1}
                      className="px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
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
                  <label className="flex items-center justify-between px-3 py-2 rounded border border-slate-200 bg-slate-50">
                    <span className="text-sm font-medium text-slate-500">廃車にする</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={form.isDisposed}
                      onClick={() => setForm((f) => ({ ...f, isDisposed: !f.isDisposed }))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        form.isDisposed ? "bg-red-600" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                          form.isDisposed ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </label>
                  {form.isDisposed && (
                    <p className="text-xs text-red-600 mt-1">
                      廃車にすると一覧でナンバーに斜線が入ります（番号は保持されます）。
                    </p>
                  )}
                </div>
                <div>
                  <label className="flex items-center justify-between px-3 py-2 rounded border border-slate-200 bg-slate-50">
                    <span className="text-sm font-medium text-slate-500">EV（電気自動車）</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={form.isEv}
                      onClick={() => setForm((f) => ({ ...f, isEv: !f.isEv }))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        form.isEv ? "bg-emerald-600" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                          form.isEv ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </label>
                  {form.isEv && (
                    <p className="text-xs text-emerald-700 mt-1">
                      EV 車は日報フォームで走行距離（メーター）入力欄を表示しません。
                    </p>
                  )}
                </div>

                {/* 車検・自賠責は車両そのものの基礎情報なので「基本」に置く（旧: 記録タブ） */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">次回車検予定日</label>
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
                    <label className="block text-sm font-medium text-slate-500 mb-1">自賠責の更新月</label>
                    <MonthYearPicker
                      value={
                        /^\d{4}-\d{2}$/.test(form.jibaisekiRenewalMonth)
                          ? {
                              year: Number(form.jibaisekiRenewalMonth.slice(0, 4)),
                              month: Number(form.jibaisekiRenewalMonth.slice(5, 7)),
                            }
                          : undefined
                      }
                      onChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          jibaisekiRenewalMonth: `${v.year}-${String(v.month).padStart(2, "0")}`,
                        }))
                      }
                    />
                  </div>
                </div>
                </>
                )}

                {vehTab === "work" && (
                <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium text-slate-500">利用ドライバー</label>
                    <button
                      type="button"
                      onClick={() => setDriverOpen((o) => !o)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors"
                    >
                      <FontAwesomeIcon icon={driverOpen ? faChevronUp : faChevronDown} className="w-2.5 h-2.5" />
                      {driverOpen ? "閉じる" : "ドライバーを選択"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {drivers.filter((d) => form.driverIds.includes(d.id)).map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggleDriver(d.id)}
                        className="px-3 py-1.5 rounded text-sm font-medium border bg-slate-800 text-white border-slate-800 transition-transform active:scale-95"
                      >
                        {getDisplayName(d)}
                      </button>
                    ))}
                    {form.driverIds.length === 0 && <span className="text-xs text-slate-400 py-1.5">未選択</span>}
                  </div>
                  <div className={`grid transition-all duration-300 ease-out ${driverOpen ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"}`}>
                    <div className="overflow-hidden">
                      <div className="flex flex-wrap gap-2 pt-1">
                        {drivers.filter((d) => !form.driverIds.includes(d.id)).map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => toggleDriver(d.id)}
                            className="px-3 py-1.5 rounded text-sm font-medium border bg-white text-slate-600 border-slate-200 hover:bg-slate-50 transition-colors"
                          >
                            {getDisplayName(d)}
                          </button>
                        ))}
                        {drivers.filter((d) => !form.driverIds.includes(d.id)).length === 0 && (
                          <span className="text-xs text-slate-400 py-1.5">追加できるドライバーはいません</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">現在メーター (km)</label>
                    <input
                      type="number"
                      value={form.currentMileage}
                      onChange={(e) => setForm((f) => ({ ...f, currentMileage: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">前回オイル交換時 (km)</label>
                    <input
                      type="number"
                      value={form.lastOilChangeMileage}
                      onChange={(e) => setForm((f) => ({ ...f, lastOilChangeMileage: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">交換間隔 (km)</label>
                  <input
                    type="number"
                    value={form.oilChangeInterval}
                    onChange={(e) => setForm((f) => ({ ...f, oilChangeInterval: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                  <p className="text-xs text-slate-500 mt-1">デフォルト: 3,000km</p>
                </div>

                </>
                )}

                {vehTab === "cost" && canViewCost && (
                <>
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">購入費用明細 (円)</label>
                  <div className="border border-slate-200 rounded-md overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-2 py-2 text-left text-slate-600 w-20">符号</th>
                          <th className="px-2 py-2 text-left text-slate-600">項目</th>
                          <th className="px-2 py-2 text-right text-slate-600 w-32">金額</th>
                          <th className="px-2 py-2 w-12"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {form.purchaseCostItems.map((item, idx) => (
                          <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                            <td className="px-2 py-2 align-middle">
                              <CustomSelect
                                size="sm"
                                clearable={false}
                                value={item.sign}
                                onChange={(value) =>
                                  setForm((f) => ({
                                    ...f,
                                    purchaseCostItems: f.purchaseCostItems.map((row, i) =>
                                      i === idx ? { ...row, sign: value === "-" ? "-" : "+" } : row
                                    ),
                                  }))
                                }
                                options={[
                                  { value: "+", label: "+" },
                                  { value: "-", label: "-" },
                                ]}
                              />
                            </td>
                            <td className="px-2 py-2 align-middle">
                              <input
                                type="text"
                                value={item.label}
                                onChange={(e) =>
                                  setForm((f) => ({
                                    ...f,
                                    purchaseCostItems: f.purchaseCostItems.map((row, i) =>
                                      i === idx ? { ...row, label: e.target.value } : row
                                    ),
                                  }))
                                }
                                placeholder="例: 車検費用 / 車税 / タイヤ"
                                className="w-full h-9 px-3 border border-slate-200 rounded bg-white"
                              />
                            </td>
                            <td className="px-2 py-2 align-middle">
                              <input
                                type="number"
                                min={0}
                                value={item.amount}
                                onChange={(e) =>
                                  setForm((f) => ({
                                    ...f,
                                    purchaseCostItems: f.purchaseCostItems.map((row, i) =>
                                      i === idx ? { ...row, amount: e.target.value } : row
                                    ),
                                  }))
                                }
                                className="w-full h-9 px-3 text-right border border-slate-200 rounded bg-white tabular-nums"
                              />
                            </td>
                            <td className="px-2 py-2 text-center align-middle">
                              <button
                                type="button"
                                onClick={() =>
                                  setForm((f) => ({
                                    ...f,
                                    purchaseCostItems:
                                      f.purchaseCostItems.length > 1
                                        ? f.purchaseCostItems.filter((_, i) => i !== idx)
                                        : f.purchaseCostItems,
                                  }))
                                }
                                className="inline-flex items-center justify-center w-9 h-9 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                                title="この明細を削除"
                              >
                                <FontAwesomeIcon icon={faTrash} className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          purchaseCostItems: [...f.purchaseCostItems, emptyPurchaseItem()],
                        }))
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 rounded hover:bg-slate-50 bg-white"
                    >
                      <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                      明細追加
                    </button>
                    <div className="text-sm font-semibold text-slate-700">
                      合計:{" "}
                      {fmt(
                        Math.max(
                          0,
                          form.purchaseCostItems.reduce((sum, it) => {
                            const n = Number(String(it.amount ?? "").replace(/[^\d]/g, "")) || 0;
                            return sum + (it.sign === "-" ? -n : n);
                          }, 0),
                        ),
                      )}
                      円
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">月々保険料 (円)</label>
                    <input
                      type="number"
                      value={form.monthlyInsurance}
                      onChange={(e) => setForm((f) => ({ ...f, monthlyInsurance: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <p className="text-xs text-slate-500 mt-1">リース代から差し引きます</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">月々リース代 (円)</label>
                    <input
                      type="number"
                      value={form.leaseCost}
                      onChange={(e) => setForm((f) => ({ ...f, leaseCost: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <p className="text-xs text-slate-500 mt-1">デフォルト: {fmt(DEFAULT_LEASE_COST)}円</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">回収開始月</label>
                    <MonthYearPicker
                      value={
                        /^\d{4}-\d{2}/.test(form.recoveryStartMonth)
                          ? { year: Number(form.recoveryStartMonth.slice(0, 4)), month: Number(form.recoveryStartMonth.slice(5, 7)) }
                          : undefined
                      }
                      onChange={({ year, month }) =>
                        setForm((f) => ({ ...f, recoveryStartMonth: `${year}-${String(month).padStart(2, "0")}` }))
                      }
                    />
                    <p className="text-xs text-slate-500 mt-1">初期費用回収のカレンダー月の起点</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-500 mb-1">繰越（移行済み回収）(円)</label>
                    <input
                      type="number"
                      value={form.recoveryCarryover}
                      onChange={(e) => setForm((f) => ({ ...f, recoveryCarryover: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                    <p className="text-xs text-slate-500 mt-1">過去に回収済みの累計（旧データから移行）</p>
                  </div>
                </div>

                </>
                )}

                {vehTab === "record" && (
                <>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium text-slate-500">車両画像</label>
                    <span className="text-[11px] text-slate-500">ドラッグ&ドロップ / クリックで選択</span>
                  </div>
                  <div
                    className={`group relative w-full rounded-lg border-2 border-dashed p-4 transition-colors ${
                      imageDragOver
                        ? "border-slate-800 bg-slate-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                    onClick={() => imageInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setImageDragOver(true);
                    }}
                    onDragLeave={() => setImageDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setImageDragOver(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) readImageFileAsDataUrl(file);
                    }}
                  >
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) readImageFileAsDataUrl(file);
                      }}
                    />

                    {form.imageDataUrl ? (
                      // 画像は1枚だけ。その上で切り取り範囲（一覧に出る 16:9）を指定する。
                      // 親のクリック（差し替え）を拾わないよう stopPropagation する。
                      <div onClick={(e) => e.stopPropagation()}>
                        <ImageFocusPicker
                          src={form.imageDataUrl}
                          value={{ x: form.imageFocusX, y: form.imageFocusY }}
                          onChange={({ x, y }) => setForm((f) => ({ ...f, imageFocusX: x, imageFocusY: y }))}
                          onReplace={() => imageInputRef.current?.click()}
                          onExpand={() => setLightboxSrc(form.imageDataUrl)}
                          disabled={!canWrite}
                        />
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, imageDataUrl: "" }))}
                          className="absolute top-3 right-3 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/90 border border-slate-200 text-slate-500 shadow-sm transition-colors hover:text-red-600 hover:bg-white"
                          title="画像を削除"
                        >
                          <FontAwesomeIcon icon={faTrash} className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="h-52 sm:h-60 rounded-md flex items-center justify-center text-slate-500 text-sm">
                        <div className="text-center space-y-1">
                          <div className="font-medium text-slate-700">画像をアップロード</div>
                          <div className="text-xs text-slate-500">
                            ここに画像をドロップするか、クリックして選択してください
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                </>
                )}
              </div>

              <div className="flex flex-col gap-3 pt-4 mt-4 border-t border-slate-100 shrink-0">
                <div className="flex items-center justify-end gap-3">
                  {editingVehicle ? (
                    <>
                      <span className="text-xs text-slate-400">
                        {saving || autoSave === "saving"
                          ? "保存中…"
                          : autoSave === "saved"
                            ? "自動保存しました"
                            : autoSave === "error"
                              ? "保存に失敗しました"
                              : "変更は自動保存されます"}
                      </span>
                      <button
                        onClick={() => {
                          flushAutoSave(); // 保留中の変更を確定させてから閉じる
                          setShowModal(false);
                        }}
                        className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded hover:bg-slate-700 transition-colors"
                      >
                        閉じる
                      </button>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
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
                              setVehicles((prev) => prev.filter((v) => v.id !== vehicleId));
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
        <div className="modal-backdrop-in fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4" onClick={() => setOpenDetail(null)}>
          <div className={`modal-panel-in bg-white rounded-lg shadow-lg w-full max-h-[90vh] overflow-y-auto ${openDetail.type === "recovery" ? "max-w-3xl" : "max-w-xl"}`} onClick={(e) => e.stopPropagation()}>
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

                  {/* 期間指定 & タブ */}
                  <div className="mb-3 space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-[180px]">
                        <div className="text-xs text-slate-500 mb-1">開始日</div>
                        <DatePicker
                          value={meterRange?.start ? toDateObj(meterRange.start) : undefined}
                          onChange={(d) => {
                            const next = d ? format(d, "yyyy-MM-dd") : "";
                            setMeterRange((r) => ({ start: next, end: r?.end ?? todayJST() }));
                          }}
                          placeholder="開始日"
                        />
                      </div>
                      <div className="min-w-[180px]">
                        <div className="text-xs text-slate-500 mb-1">終了日</div>
                        <DatePicker
                          value={meterRange?.end ? toDateObj(meterRange.end) : undefined}
                          onChange={(d) => {
                            const next = d ? format(d, "yyyy-MM-dd") : "";
                            setMeterRange((r) => ({ start: r?.start ?? todayJST(), end: next }));
                          }}
                          placeholder="終了日"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={meterLoading || !meterRange?.start || !meterRange?.end}
                        onClick={() => {
                          if (!meterRange?.start || !meterRange?.end) return;
                          fetchMeterLogs(openDetail.vehicle.id, meterRange);
                        }}
                        className="h-10 px-3 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-sm"
                      >
                        {meterLoading ? "更新中..." : "更新"}
                      </button>
                      <button
                        type="button"
                        disabled={meterLoading}
                        onClick={() => {
                          const r = defaultRangeLast30Days();
                          setMeterRange(r);
                          fetchMeterLogs(openDetail.vehicle.id, r);
                        }}
                        className="h-10 px-3 rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 text-sm"
                        title="過去30日に戻す"
                      >
                        30日
                      </button>
                    </div>

                    <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setMeterTab("table")}
                        className={`px-3 py-1.5 text-sm ${meterTab === "table"
                          ? "bg-slate-800 text-white"
                          : "bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                      >
                        テーブル
                      </button>
                      <button
                        type="button"
                        onClick={() => setMeterTab("graph")}
                        className={`px-3 py-1.5 text-sm ${meterTab === "graph"
                          ? "bg-slate-800 text-white"
                          : "bg-white text-slate-700 hover:bg-slate-50"
                          }`}
                      >
                        グラフ
                      </button>
                    </div>
                  </div>

                  {meterError && (
                    <div className="mb-3 text-xs text-red-600 border border-red-200 bg-red-50 rounded-md p-2">
                      取得に失敗しました: {meterError}
                    </div>
                  )}

                  {/* テーブル */}
                  {meterTab === "table" && (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-2 py-2 text-left text-slate-600">日付</th>
                            <th className="px-2 py-2 text-left text-slate-600">利用者</th>
                            <th className="px-2 py-2 text-right text-slate-600">メーター</th>
                            <th className="px-2 py-2 text-right text-slate-600">前日比</th>
                          </tr>
                        </thead>
                        <tbody>
                          {meterLoading ? (
                            <tr>
                              <td className="px-2 py-3 text-center text-slate-500" colSpan={4}>
                                読み込み中...
                              </td>
                            </tr>
                          ) : meterRows.length === 0 ? (
                            <tr>
                              <td className="px-2 py-3 text-center text-slate-500" colSpan={4}>
                                この期間のメーターログがありません
                              </td>
                            </tr>
                          ) : (
                            [...meterRows].reverse().map((r, idx) => (
                              <tr key={`${r.report_date}-${idx}`} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                                <td className="px-2 py-2 text-slate-700">
                                  {r.report_date.split("-").map((x, i) => (i === 0 ? x : parseInt(x, 10))).join("/")}
                                </td>
                                <td className="px-2 py-2 text-slate-700">{getDisplayName(r.driver)}</td>
                                <td className="px-2 py-2 text-right font-medium text-slate-900">{fmt(r.meter_value)} km</td>
                                <td className="px-2 py-2 text-right text-slate-700">
                                  {r.delta == null ? (
                                    <span className="text-slate-400">-</span>
                                  ) : (
                                    <span className={r.delta >= 0 ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
                                      {fmtSigned(r.delta)} km
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* グラフ */}
                  {meterTab === "graph" && (
                    <div className="space-y-3">
                      <div className="border border-slate-200 rounded-lg p-3">
                        {meterLoading ? (
                          <div className="text-xs text-slate-500 text-center py-8">読み込み中...</div>
                        ) : meterRows.length < 2 ? (
                          <div className="text-xs text-slate-500 text-center py-8">
                            グラフ表示には2件以上のログが必要です
                          </div>
                        ) : (
                          (() => {
                            const oilPrev = openDetail.vehicle.last_oil_change_mileage;
                            const oilNext = openDetail.vehicle.last_oil_change_mileage + openDetail.vehicle.oil_change_interval;

                            const ys = [
                              ...meterRows.map((r) => r.meter_value),
                              oilPrev,
                              oilNext,
                            ];
                            const minY = Math.min(...ys);
                            const maxY = Math.max(...ys);
                            const padY = Math.max(50, Math.round((maxY - minY) * 0.08));
                            const y0 = minY - padY;
                            const y1 = maxY + padY;

                            const w = 520;
                            const h = 220;
                            const padL = 44;
                            const padR = 16;
                            const padT = 12;
                            const padB = 34;
                            const innerW = w - padL - padR;
                            const innerH = h - padT - padB;
                            const n = meterRows.length;
                            const xAt = (i: number) => padL + (innerW * i) / (n - 1);
                            const yAt = (v: number) => {
                              if (y1 === y0) return padT + innerH / 2;
                              const t = (v - y0) / (y1 - y0);
                              return padT + innerH * (1 - t);
                            };
                            const points = meterRows.map((r, i) => ({ x: xAt(i), y: yAt(r.meter_value), r, i }));
                            const linePts = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

                            const selected = (meterSelectedIdx != null ? meterRows[meterSelectedIdx] : null) ?? meterRows[meterRows.length - 1];
                            const selectedIdx = meterSelectedIdx != null ? meterSelectedIdx : meterRows.length - 1;
                            const selectedPrev = selectedIdx > 0 ? meterRows[selectedIdx - 1] : null;
                            const selectedDelta = selectedPrev ? selected.meter_value - selectedPrev.meter_value : null;

                            return (
                              <div className="space-y-3">
                                <div className="w-full overflow-x-auto">
                                  <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[520px]">
                                    {/* grid */}
                                    {[0, 1, 2, 3].map((k) => {
                                      const yy = padT + (innerH * k) / 3;
                                      const val = y0 + ((y1 - y0) * (3 - k)) / 3;
                                      return (
                                        <g key={k}>
                                          <line x1={padL} x2={w - padR} y1={yy} y2={yy} stroke="#e2e8f0" strokeWidth="1" />
                                          <text x={padL - 6} y={yy + 4} textAnchor="end" fontSize="10" fill="#64748b">
                                            {fmt(Math.round(val))}
                                          </text>
                                        </g>
                                      );
                                    })}

                                    {/* oil prev/next lines */}
                                    <line x1={padL} x2={w - padR} y1={yAt(oilPrev)} y2={yAt(oilPrev)} stroke="#0f172a" strokeWidth="1" strokeDasharray="4 3" />
                                    <text x={w - padR} y={yAt(oilPrev) - 4} textAnchor="end" fontSize="10" fill="#0f172a">
                                      前回 {fmt(oilPrev)}
                                    </text>
                                    <line x1={padL} x2={w - padR} y1={yAt(oilNext)} y2={yAt(oilNext)} stroke="#ef4444" strokeWidth="1" strokeDasharray="4 3" />
                                    <text x={w - padR} y={yAt(oilNext) - 4} textAnchor="end" fontSize="10" fill="#ef4444">
                                      次回 {fmt(oilNext)}
                                    </text>

                                    {/* line */}
                                    <polyline fill="none" stroke="#2563eb" strokeWidth="2.5" points={linePts} />

                                    {/* points */}
                                    {points.map((p) => {
                                      const isSel = p.i === selectedIdx;
                                      return (
                                        <g
                                          key={p.i}
                                          onClick={() => setMeterSelectedIdx(p.i)}
                                          style={{ cursor: "pointer" }}
                                        >
                                          <circle cx={p.x} cy={p.y} r={isSel ? 5 : 4} fill={isSel ? "#0f172a" : "#2563eb"} />
                                        </g>
                                      );
                                    })}

                                    {/* x labels (start/end) */}
                                    <text x={padL} y={h - 10} textAnchor="start" fontSize="10" fill="#64748b">
                                      {meterRows[0].report_date.slice(5).replace("-", "/")}
                                    </text>
                                    <text x={w - padR} y={h - 10} textAnchor="end" fontSize="10" fill="#64748b">
                                      {meterRows[meterRows.length - 1].report_date.slice(5).replace("-", "/")}
                                    </text>
                                  </svg>
                                </div>

                                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                    <div>
                                      <span className="text-slate-500">日付:</span>{" "}
                                      <span className="font-medium">
                                        {selected.report_date.split("-").map((x, i) => (i === 0 ? x : parseInt(x, 10))).join("/")}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">利用者:</span>{" "}
                                      <span className="font-medium">{getDisplayName(selected.driver)}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">メーター:</span>{" "}
                                      <span className="font-medium text-slate-900">{fmt(selected.meter_value)} km</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">前日比:</span>{" "}
                                      {selectedDelta == null ? (
                                        <span className="text-slate-400">-</span>
                                      ) : (
                                        <span className={selectedDelta >= 0 ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
                                          {fmtSigned(selectedDelta)} km
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-2 text-[11px] text-slate-500">
                                    点をクリックすると、その日の詳細（前日比含む）を表示します。
                                  </div>
                                </div>
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {openDetail.type === "recovery" && canViewCost && (
                <VehicleRecoveryDetail
                  vehicleId={openDetail.vehicle.id}
                  title={`${openDetail.vehicle.manufacturer ?? ""} ${openDetail.vehicle.brand ?? ""}`.trim()}
                  canWrite={canWrite}
                  onClose={() => setOpenDetail(null)}
                  onRecoveredChange={(rec, rem) => syncRecovered(openDetail.vehicle.id, rec, rem)}
                />
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

      {qrVehicle && (
        <VehicleQrModal vehicle={qrVehicle} onClose={() => setQrVehicle(null)} />
      )}

      {showBulkQr && (
        <VehicleQrBulkModal
          vehicles={vehicles.filter((v) => !v.is_disposed)}
          onClose={() => setShowBulkQr(false)}
        />
      )}
      <ErrorDialog
        open={!!errorState}
        title={errorState?.title}
        message={errorState?.message ?? ""}
        detail={errorState?.detail}
        onClose={() => setErrorState(null)}
      />
      <ImageLightbox src={lightboxSrc} alt="車両画像" onClose={() => setLightboxSrc(null)} />
    </AdminLayout>
  );
}
