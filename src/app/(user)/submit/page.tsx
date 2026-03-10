"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleExclamation } from "@fortawesome/free-solid-svg-icons";
import html2canvas from "html2canvas";
import { Skeleton } from "@/lib/components/Skeleton";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import { DatePicker } from "@/lib/components/DatePicker";
import { apiFetch, getStoredDriver } from "@/lib/api";
import { reportDateDefaultJST, reportDateStrToDate, dateToReportDateStr } from "@/lib/date";
import { JukenCertificate, type JukenNumbers, type JukenOverlay } from "@/lib/components/JukenCertificate";

type Vehicle = {
  id: string;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
  current_mileage: number;
  last_oil_change_mileage?: number;
  oil_change_interval?: number;
};

function getInitialReportDate(): Date {
  return reportDateStrToDate(reportDateDefaultJST());
}

export default function SubmitPage() {
  const [reportDate, setReportDate] = useState<Date>(getInitialReportDate);
  const [carrier, setCarrier] = useState<"YAMATO" | "AMAZON">("YAMATO");
  const [form, setForm] = useState({
    takuhaibinCompleted: "",
    takuhaibinReturned: "",
    nekoposCompleted: "",
    nekoposReturned: "",
  });
  const [amazonForm, setAmazonForm] = useState({
    amMochidashi: "",
    amCompleted: "",
    pmMochidashi: "",
    pmCompleted: "",
    fourMochidashi: "",
    fourCompleted: "",
  });
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [meterValue, setMeterValue] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [showVehicleSelector, setShowVehicleSelector] = useState(false);
  const [unlinkedVehicles, setUnlinkedVehicles] = useState<Vehicle[]>([]);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [confirmVehicle, setConfirmVehicle] = useState<Vehicle | null>(null);
  const [driverProfile, setDriverProfile] = useState<{ name: string; officeCode: string; driverCode: string } | null>(null);
  const [certImageDataUrl, setCertImageDataUrl] = useState<string | null>(null);
  const [oilReminderModal, setOilReminderModal] = useState<{
    nextOilChangeKm: number;
    oilProgress: number;
    lastOil: number;
    interval: number;
    currentKm: number;
  } | null>(null);
  const certRef = useRef<HTMLDivElement | null>(null);
  const vehicleItemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const defaultReportDateRef = useRef(reportDateDefaultJST());

  // 日本時間 午前3:00 でデフォルト日付が切り替わるため、表示中の日付を同期
  useEffect(() => {
    const interval = setInterval(() => {
      const newDefault = reportDateDefaultJST();
      const firstOfMonthStr = newDefault.slice(0, 7) + "-01";
      const currentStr = dateToReportDateStr(reportDate);
      if (currentStr < firstOfMonthStr || currentStr > newDefault) {
        setReportDate(reportDateStrToDate(newDefault));
        defaultReportDateRef.current = newDefault;
      } else if (newDefault !== defaultReportDateRef.current) {
        if (currentStr === defaultReportDateRef.current) {
          setReportDate(reportDateStrToDate(newDefault));
        }
        defaultReportDateRef.current = newDefault;
      }
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [reportDate]);

  const set = (key: keyof typeof form, value: string) => {
    if (value !== "" && !/^\d+$/.test(value)) return;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const setAmazon = (key: keyof typeof amazonForm, value: string) => {
    if (value !== "" && !/^\d+$/.test(value)) return;
    setAmazonForm((f) => ({ ...f, [key]: value }));
  };

  useEffect(() => {
    const load = async () => {
      setVehiclesLoading(true);
      try {
        const [vehiclesRes, prefRes, profileRes, unlinkedRes] = await Promise.all([
          apiFetch<{ vehicles: Vehicle[] }>("/api/reports/vehicles", { cache: "no-store" }),
          apiFetch<{ vehicleId: string | null }>("/api/reports/vehicle-preference"),
          apiFetch<{ name: string; officeCode: string; driverCode: string }>("/api/reports/profile").catch(() => null),
          apiFetch<{ vehicles: Vehicle[] }>("/api/reports/vehicles-unlinked", { cache: "no-store" }).catch(
            () => ({ vehicles: [] as Vehicle[] }),
          ),
        ]);
        setVehicles(vehiclesRes.vehicles);
        setUnlinkedVehicles(unlinkedRes.vehicles ?? []);
        if (profileRes) setDriverProfile(profileRes);
        if (prefRes.vehicleId && vehiclesRes.vehicles.some((v) => v.id === prefRes.vehicleId)) {
          setSelectedVehicleId(prefRes.vehicleId);
          const idx = vehiclesRes.vehicles.findIndex((v) => v.id === prefRes.vehicleId);
          if (idx >= 0) setCarouselIndex(idx);
        } else if (vehiclesRes.vehicles.length > 0) {
          setSelectedVehicleId(vehiclesRes.vehicles[0].id);
          setCarouselIndex(0);
        }
        if (vehiclesRes.vehicles.length === 1 && vehiclesRes.vehicles[0].current_mileage > 0) {
          setMeterValue(String(vehiclesRes.vehicles[0].current_mileage));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setVehiclesLoading(false);
      }
    };
    load();
  }, []);

  const saveVehiclePreference = async (vehicleId: string) => {
    try {
      await apiFetch("/api/reports/vehicle-preference", {
        method: "PUT",
        body: JSON.stringify({ vehicleId }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleVehicleSelect = (v: Vehicle, index: number) => {
    setSelectedVehicleId(v.id);
    setCarouselIndex(index);
    saveVehiclePreference(v.id);
    if (v.current_mileage > 0) {
      setMeterValue(String(v.current_mileage));
    }
  };

  useEffect(() => {
    if (vehiclesLoading) return;
    if (!showVehicleSelector) return;
    vehicleItemRefs.current[carouselIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [carouselIndex, vehiclesLoading, showVehicleSelector]);

  const allKnownVehicles = [...vehicles, ...unlinkedVehicles];

  const getSelectedVehicle = () => {
    if (!selectedVehicleId) return null;
    return (
      allKnownVehicles.find((v) => v.id === selectedVehicleId) ??
      null
    );
  };

  const handleUnlinkedSelect = (v: Vehicle) => {
    setConfirmVehicle(v);
  };

  const confirmUnlinkedSelection = () => {
    if (!confirmVehicle) return;
    setVehicles((prev) => {
      if (prev.some((x) => x.id === confirmVehicle.id)) return prev;
      return [...prev, confirmVehicle];
    });
    setSelectedVehicleId(confirmVehicle.id);
    if (confirmVehicle.current_mileage > 0) {
      setMeterValue(String(confirmVehicle.current_mileage));
    }
    setShowVehicleModal(false);
    setConfirmVehicle(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      await apiFetch("/api/reports", {
        method: "POST",
        body: JSON.stringify({
          reportDate: dateToReportDateStr(reportDate),
          carrier,
          takuhaibinCompleted: Number(form.takuhaibinCompleted) || 0,
          takuhaibinReturned: Number(form.takuhaibinReturned) || 0,
          nekoposCompleted: Number(form.nekoposCompleted) || 0,
          nekoposReturned: Number(form.nekoposReturned) || 0,
          amazonAmMochidashi: Number(amazonForm.amMochidashi) || 0,
          amazonAmCompleted: Number(amazonForm.amCompleted) || 0,
          amazonPmMochidashi: Number(amazonForm.pmMochidashi) || 0,
          amazonPmCompleted: Number(amazonForm.pmCompleted) || 0,
          amazon4Mochidashi: Number(amazonForm.fourMochidashi) || 0,
          amazon4Completed: Number(amazonForm.fourCompleted) || 0,
          vehicleId: selectedVehicleId,
          meterValue: meterValue ? Number(meterValue) : null,
        }),
      });
      if (selectedVehicleId) saveVehiclePreference(selectedVehicleId);
      setStatus("success");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "送信に失敗しました");
    }
  };

  const jukenOverlay: JukenOverlay | undefined = useMemo(() => {
    const driver = driverProfile ?? getStoredDriver();
    if (!driver?.name) return undefined;
    const digits6 = (driver.driverCode ?? "").replace(/\D/g, "").slice(-6);
    const d = reportDate;
    const ymd = dateToReportDateStr(d).split("-").map(Number);
    return {
      officeCode: driver.officeCode ?? "",
      personalNumber: digits6,
      name: driver.name,
      date: {
        year: ymd[0],
        month: ymd[1],
        day: ymd[2],
      },
    };
  }, [driverProfile, reportDate]);

  const jukenNumbers: JukenNumbers = useMemo(() => {
    if (carrier !== "YAMATO") {
      return {
        takuhaibinMochidashi: 0,
        takuhaibinHaikan: 0,
        takuhaibinModori: 0,
        takuhaibinHaikanModori: 0,
        nekoposMochidashi: 0,
        nekoposHaikan: 0,
        nekoposModori: 0,
        nekoposHaikanModori: 0,
        totalMochidashi: 0,
        totalHaikan: 0,
        totalModori: 0,
        totalHaikanModori: 0,
      };
    }
    const tkComp = Number(form.takuhaibinCompleted) || 0;
    const tkRet = Number(form.takuhaibinReturned) || 0;
    const nkComp = Number(form.nekoposCompleted) || 0;
    const nkRet = Number(form.nekoposReturned) || 0;

    const takuhaibinMochidashi = tkComp + tkRet;
    const nekoposMochidashi = nkComp + nkRet;
    const totalMochidashi = takuhaibinMochidashi + nekoposMochidashi;
    const totalHaikan = tkComp + nkComp;
    const totalModori = tkRet + nkRet;
    const totalHaikanModori = totalHaikan + totalModori;

    return {
      takuhaibinMochidashi,
      takuhaibinHaikan: tkComp,
      takuhaibinModori: tkRet,
      takuhaibinHaikanModori: takuhaibinMochidashi,
      nekoposMochidashi,
      nekoposHaikan: nkComp,
      nekoposModori: nkRet,
      nekoposHaikanModori: nekoposMochidashi,
      totalMochidashi,
      totalHaikan,
      totalModori,
      totalHaikanModori,
    };
  }, [form]);

  const yamatoFields: { key: keyof typeof form; label: string; sub: string }[] = [
    { key: "takuhaibinCompleted", label: "宅急便", sub: "完了" },
    { key: "takuhaibinReturned", label: "宅急便", sub: "持戻" },
    { key: "nekoposCompleted", label: "ネコポス", sub: "完了" },
    { key: "nekoposReturned", label: "ネコポス", sub: "持戻" },
  ];

  const amazonFields: { key: keyof typeof amazonForm; label: string; sub: string }[] = [
    { key: "amMochidashi", label: "午前", sub: "持出" },
    { key: "amCompleted", label: "午前", sub: "完了" },
    { key: "pmMochidashi", label: "午後", sub: "持出" },
    { key: "pmCompleted", label: "午後", sub: "完了" },
    { key: "fourMochidashi", label: "4便", sub: "持出" },
    { key: "fourCompleted", label: "4便", sub: "完了" },
  ];

  const amazonReturns = useMemo(() => {
    const amMochi = Number(amazonForm.amMochidashi) || 0;
    const amComp = Number(amazonForm.amCompleted) || 0;
    const pmMochi = Number(amazonForm.pmMochidashi) || 0;
    const pmComp = Number(amazonForm.pmCompleted) || 0;
    const fourMochi = Number(amazonForm.fourMochidashi) || 0;
    const fourComp = Number(amazonForm.fourCompleted) || 0;

    return {
      amReturn: Math.max(amMochi - amComp, 0),
      pmReturn: Math.max(pmMochi - pmComp, 0),
      fourReturn: Math.max(fourMochi - fourComp, 0),
    };
  }, [amazonForm]);

  // 提出完了時に証明書を画像化（長押し保存・ダウンロード用）※ヤマトのみ
  useEffect(() => {
    if (status !== "success" || carrier !== "YAMATO") return;
    setCertImageDataUrl(null);
    const timer = setTimeout(async () => {
      if (!certRef.current) return;
      try {
        const canvas = await html2canvas(certRef.current, {
          scale: 3,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
        });
        setCertImageDataUrl(canvas.toDataURL("image/png"));
      } catch (e) {
        console.error(e);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === "success") {
    return (
      <div className="max-w-sm mx-auto mt-12 px-4 pb-12">
        {/* キャプチャ用（画面外に配置）：ヤマトのみ */}
        {carrier === "YAMATO" && (
          <div className="fixed left-[-9999px] top-0" aria-hidden>
            <JukenCertificate
              certificateRef={(el) => {
                certRef.current = el;
              }}
              numbers={jukenNumbers}
              overlay={jukenOverlay}
              hideDownloadButton
            />
          </div>
        )}

        <div className="text-center mb-6">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">送信完了</h2>
          <p className="text-sm text-slate-500 mb-6">本日の日報を提出しました</p>
        </div>

        {/* 配達受託者控画像：長押しでカメラロールに保存（ヤマトのみ） */}
        {carrier === "YAMATO" && (
          <div className="mb-6">
            {certImageDataUrl ? (
              <>
                <img
                  src={certImageDataUrl}
                  alt="配達受託者控"
                  className="w-full max-w-[600px] mx-auto rounded-lg border border-slate-200 block"
                  style={{ maxHeight: "70vh", objectFit: "contain" }}
                />
              </>
            ) : (
              <p className="text-sm text-slate-500 py-8">画像を生成しています...</p>
            )}
          </div>
        )}

        <div className="text-center">
          <button
            onClick={() => {
              setStatus("idle");
              setReportDate(getInitialReportDate());
              setForm({
                takuhaibinCompleted: "",
                takuhaibinReturned: "",
                nekoposCompleted: "",
                nekoposReturned: "",
              });
              setAmazonForm({
                amMochidashi: "",
                amCompleted: "",
                pmMochidashi: "",
                pmCompleted: "",
                fourMochidashi: "",
                fourCompleted: "",
              });
              setCertImageDataUrl(null);
            }}
            className="text-sm text-brand-600 font-medium hover:underline"
          >
            もう一度入力する（上書き）
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto px-4 py-8">
      <h1 className="text-lg font-bold text-brand-900 mb-6">日報送信</h1>

      {/* 送信する日付（日本時間 3:00 でデフォルト日付が切り替わります） */}
      <div className="mb-6 flex items-center gap-2">
        <label className="block text-sm font-medium text-slate-700 mb-2">日付</label>
        <DatePicker
          value={reportDate}
          onChange={(date) => date != null && setReportDate(date)}
          placeholder="日付を選択"
          className="w-auto"
          fromDate={reportDateStrToDate(reportDateDefaultJST().slice(0, 7) + "-01")}
          toDate={reportDateStrToDate(reportDateDefaultJST())}
        />
      </div>

      {/* 配送種別選択 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-2">配送種別</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setCarrier("YAMATO")}
            className={`py-2.5 rounded-xl text-sm font-semibold border ${carrier === "YAMATO"
              ? "bg-brand-800 text-white border-brand-800"
              : "bg-white text-slate-700 border-slate-200"
              }`}
          >
            ヤマト
          </button>
          <button
            type="button"
            onClick={() => setCarrier("AMAZON")}
            className={`py-2.5 rounded-xl text-sm font-semibold border ${carrier === "AMAZON"
              ? "bg-brand-800 text-white border-brand-800"
              : "bg-white text-slate-700 border-slate-200"
              }`}
          >
            Amazon
          </button>
        </div>
      </div>

      {/* 車両選択 */}
      {vehiclesLoading ? (
        <div className="mb-6">
          <Skeleton className="h-4 w-20 mb-2" />
          <div className="flex gap-2 overflow-x-auto pb-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-32 flex-shrink-0 rounded-lg" />
            ))}
          </div>
        </div>
      ) : vehicles.length > 0 || unlinkedVehicles.length > 0 ? (
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">使用車両</label>
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              {(() => {
                const sel =
                  getSelectedVehicle() ??
                  vehicles[0] ??
                  unlinkedVehicles[0] ??
                  null;
                if (!sel) {
                  return (
                    <div className="h-16 flex items-center text-xs text-slate-400">
                      車両が未選択です
                    </div>
                  );
                }
                // 管理画面と同じ VehiclePlate（通常）を等比縮小して表示
                return (
                  <div className="w-36 sm:w-32">
                    <div className="w-[240px] origin-top-left" style={{ transform: "scale(0.55)" }}>
                      <VehiclePlate vehicle={sel} selected className="w-full max-w-[240px]" />
                    </div>
                  </div>
                );
              })()}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowVehicleModal(true);
                setShowVehicleSelector(true);
                setConfirmVehicle(null);
              }}
              className="shrink-0 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
            >
              他の車両を選択
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-4 text-xs text-slate-500">
          使用できる車両がまだ紐付けられていないため、車両選択とメーター入力欄は表示されません。
          管理者に連絡してください。
        </div>
      )}

      {/* メーター入力 */}
      {(vehicles.length > 0 || (selectedVehicleId && getSelectedVehicle())) && (() => {
        const sel = getSelectedVehicle();
        const lastOil = sel?.last_oil_change_mileage ?? 0;
        const interval = Math.max(1, sel?.oil_change_interval ?? 3000);
        const currentKm = Number(meterValue) || sel?.current_mileage || 0;
        const oilProgress = Math.max(0, Math.min(100, ((currentKm - lastOil) / interval) * 100));
        const nextOilChangeKm = lastOil + interval;
        const showReminder = oilProgress >= 70 && interval > 0;
        const isRed = oilProgress >= 95;
        const reminderColorClass = isRed ? "text-red-500" : "text-yellow-500";

        return (
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 leading-none mb-1">
              メーター数値（km）
            </label>
            <div className="relative">
              <input
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="例: 14567"
                value={meterValue}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  setMeterValue(v);
                }}
                className={`w-full py-3 text-lg font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 ${showReminder ? "pl-4 pr-10" : "px-4"}`}
              />
              {showReminder && (
                <button
                  type="button"
                  onClick={() =>
                    setOilReminderModal({
                      nextOilChangeKm,
                      oilProgress,
                      lastOil,
                      interval,
                      currentKm,
                    })
                  }
                  className={`absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-8 h-8 rounded-lg ${reminderColorClass} hover:opacity-80 transition-opacity`}
                  title="オイル交換時期のリマインド"
                >
                  <FontAwesomeIcon icon={faCircleExclamation} className="w-5 h-5" />
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">車両のメーター数値として記録されます</p>
          </div>
        );
      })()}

      <form onSubmit={handleSubmit} className="space-y-4">
        {carrier === "YAMATO" ? (
          <div className="grid grid-cols-2 gap-3">
            {yamatoFields.map((f) => (
              <div key={f.key} className="bg-white rounded-xl border border-slate-200 p-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  {f.label}
                  <span className={f.sub === "持戻" ? "text-orange-500 ml-1" : "text-blue-500 ml-1"}>
                    {f.sub}
                  </span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                  value={form[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full text-3xl font-bold text-brand-900 py-2 border-0 focus:outline-none bg-transparent"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {/* 1行目: 持出し（午前・午後・4便） */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  午前<span className="text-slate-500 ml-1">持出</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                  value={amazonForm.amMochidashi}
                  onChange={(e) => setAmazon("amMochidashi", e.target.value)}
                  className="w-full text-3xl font-bold text-brand-900 py-2 border-0 focus:outline-none bg-transparent"
                />
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  午後<span className="text-slate-500 ml-1">持出</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                  value={amazonForm.pmMochidashi}
                  onChange={(e) => setAmazon("pmMochidashi", e.target.value)}
                  className="w-full text-3xl font-bold text-brand-900 py-2 border-0 focus:outline-none bg-transparent"
                />
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  4便<span className="text-slate-500 ml-1">持出</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                  value={amazonForm.fourMochidashi}
                  onChange={(e) => setAmazon("fourMochidashi", e.target.value)}
                  className="w-full text-3xl font-bold text-brand-900 py-2 border-0 focus:outline-none bg-transparent"
                />
              </div>
            </div>

            {/* 2行目: 完了（午前・午後・4便） */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  午前<span className="text-blue-500 ml-1">完了</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                  value={amazonForm.amCompleted}
                  onChange={(e) => setAmazon("amCompleted", e.target.value)}
                  className="w-full text-3xl font-bold text-brand-900 py-2 border-0 focus:outline-none bg-transparent"
                />
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  午後<span className="text-blue-500 ml-1">完了</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                  value={amazonForm.pmCompleted}
                  onChange={(e) => setAmazon("pmCompleted", e.target.value)}
                  className="w-full text-3xl font-bold text-brand-900 py-2 border-0 focus:outline-none bg-transparent"
                />
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  4便<span className="text-blue-500 ml-1">完了</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="0"
                  value={amazonForm.fourCompleted}
                  onChange={(e) => setAmazon("fourCompleted", e.target.value)}
                  className="w-full text-3xl font-bold text-brand-900 py-2 border-0 focus:outline-none bg-transparent"
                />
              </div>
            </div>

            {/* 自動計算された持戻り */}
            <div className="text-right text-xs text-slate-500 space-y-0.5">
              <p>
                午前 持戻{" "}
                <span className="font-semibold text-orange-600">
                  {amazonReturns.amReturn}
                </span>
                個
              </p>
              <p>
                午後 持戻{" "}
                <span className="font-semibold text-orange-600">
                  {amazonReturns.pmReturn}
                </span>
                個
              </p>
              <p>
                4便 持戻{" "}
                <span className="font-semibold text-orange-600">
                  {amazonReturns.fourReturn}
                </span>
                個
              </p>
            </div>
          </div>
        )}

        {status === "error" && (
          <p className="text-sm text-red-500 text-center">{errorMsg}</p>
        )}

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full py-3.5 bg-brand-800 text-white font-semibold rounded-xl hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {status === "loading" ? "送信中..." : "送信する"}
        </button>
      </form>

      <p className="text-xs text-slate-400 text-center mt-4">
        同日の再送信は上書きされます（ヤマト / Amazon 共通）
      </p>

      {/* 他の車両選択モーダル（紐付けられていない車両のみ） */}
      {showVehicleModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setShowVehicleModal(false);
            setConfirmVehicle(null);
          }}
        >
          <div
            className="bg-white rounded-xl shadow-lg max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-slate-900 mb-2">他の車両を選択</h2>
            <p className="text-xs text-slate-500 mb-4">
              まだドライバーに紐付けられていない車両の中から、今回使用した車両を選択してください。
            </p>

            {unlinkedVehicles.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                紐付けられていない車両がありません。
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide mb-3">
                  {unlinkedVehicles.map((v, i) => (
                    <div
                      key={v.id}
                      ref={(el) => {
                        vehicleItemRefs.current[i] = el;
                      }}
                      className="flex-shrink-0 w-36 sm:w-32"
                    >
                      <button
                        type="button"
                        onClick={() => handleUnlinkedSelect(v)}
                        className={`w-full rounded-lg border ${
                          confirmVehicle?.id === v.id
                            ? "border-slate-900"
                            : "border-slate-200 hover:border-slate-400"
                        } bg-white px-1 pt-1 pb-2`}
                      >
                        <div className="w-[240px] origin-top-left mx-auto" style={{ transform: "scale(0.55)" }}>
                          <VehiclePlate vehicle={v} className="w-full max-w-[240px]" />
                        </div>
                        {(v.manufacturer || v.brand) && (
                          <div className="mt-1 text-[10px] text-slate-500 truncate text-center">
                            {[v.manufacturer, v.brand].filter(Boolean).join(" ")}
                          </div>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                {confirmVehicle && (
                  <div className="mt-2 border-t border-slate-200 pt-3">
                    <p className="text-xs text-slate-700 mb-2">
                      この車両で正しいですか？ 日報のメーター数値はこの車両に紐づき、管理画面の未承認一覧にもこのナンバーが表示されます。
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmVehicle(null);
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800"
                      >
                        戻る
                      </button>
                      <button
                        type="button"
                        onClick={confirmUnlinkedSelection}
                        className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-white hover:bg-slate-700"
                      >
                        この車両を使う
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowVehicleModal(false);
                  setConfirmVehicle(null);
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* オイル交換リマインドモーダル */}
      {oilReminderModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setOilReminderModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base text-slate-800 text-center">
              次回オイル交換次走行距離は
              <span className="font-bold text-slate-900 mx-1">
                {oilReminderModal.nextOilChangeKm.toLocaleString("ja-JP")} km
              </span>
              です
            </p>

            {/* 車両管理と同じゲージ（進捗 + マーカー） */}
            <div className="mt-5">
              <div className="flex items-start justify-between mb-2">
                <div className="text-left">
                  <div className="text-[10px] text-slate-500 leading-tight">前回オイル交換</div>
                  <div className="text-xs font-medium text-slate-800 leading-tight">
                    {oilReminderModal.lastOil.toLocaleString("ja-JP")} km
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500 leading-tight">次回オイル交換</div>
                  <div className="text-xs font-medium text-slate-800 leading-tight">
                    {oilReminderModal.nextOilChangeKm.toLocaleString("ja-JP")} km
                  </div>
                </div>
              </div>
              {/* ▼ マーカー行 */}
              <div className="relative h-3">
                {(() => {
                  const percent = Math.min(Math.max(oilReminderModal.oilProgress, 0), 100);
                  const colorClass =
                    percent >= 95
                      ? "text-red-500"
                      : percent >= 70
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
                  const percent = Math.min(Math.max(oilReminderModal.oilProgress, 0), 100);
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
              <div className="mt-2 text-center text-[11px] text-slate-500">
                現在走行距離 {oilReminderModal.currentKm.toLocaleString("ja-JP")} km（交換目安: {oilReminderModal.interval.toLocaleString("ja-JP")} km）
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOilReminderModal(null)}
              className="mt-4 w-full py-2.5 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
