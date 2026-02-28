"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleExclamation } from "@fortawesome/free-solid-svg-icons";
import html2canvas from "html2canvas";
import { Nav } from "@/lib/components/Nav";
import { Skeleton } from "@/lib/components/Skeleton";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import { apiFetch, getStoredDriver } from "@/lib/api";
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

export default function SubmitPage() {
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
  const [driverProfile, setDriverProfile] = useState<{ name: string; officeCode: string; driverCode: string } | null>(null);
  const [certImageDataUrl, setCertImageDataUrl] = useState<string | null>(null);
  const [oilReminderModal, setOilReminderModal] = useState<{ nextOilChangeKm: number } | null>(null);
  const certRef = useRef<HTMLDivElement | null>(null);
  const vehicleItemRefs = useRef<Array<HTMLDivElement | null>>([]);

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
        const [vehiclesRes, prefRes, profileRes] = await Promise.all([
          apiFetch<{ vehicles: Vehicle[] }>("/api/reports/vehicles", { cache: "no-store" }),
          apiFetch<{ vehicleId: string | null }>("/api/reports/vehicle-preference"),
          apiFetch<{ name: string; officeCode: string; driverCode: string }>("/api/reports/profile").catch(() => null),
        ]);
        setVehicles(vehiclesRes.vehicles);
        if (profileRes) setDriverProfile(profileRes);
        if (prefRes.vehicleId && vehiclesRes.vehicles.some((v) => v.id === prefRes.vehicleId)) {
          setSelectedVehicleId(prefRes.vehicleId);
          const idx = vehiclesRes.vehicles.findIndex((v) => v.id === prefRes.vehicleId);
          if (idx >= 0) setCarouselIndex(idx);
        } else if (vehiclesRes.vehicles.length > 0) {
          setSelectedVehicleId(vehiclesRes.vehicles[0].id);
          setCarouselIndex(0);
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
    vehicleItemRefs.current[carouselIndex]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [carouselIndex, vehiclesLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      await apiFetch("/api/reports", {
        method: "POST",
        body: JSON.stringify({
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
    const today = new Date();
    return {
      officeCode: driver.officeCode ?? "",
      personalNumber: digits6,
      name: driver.name,
      date: {
        year: today.getFullYear(),
        month: today.getMonth() + 1,
        day: today.getDate(),
      },
    };
  }, [driverProfile]);

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
      <>
        <Nav />
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
      </>
    );
  }

  return (
    <>
      <Nav />
      <div className="max-w-sm mx-auto px-4 py-8">
        <h1 className="text-lg font-bold text-brand-900 mb-6">本日の日報</h1>

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

        {/* 車両選択カルーセル */}
        {vehiclesLoading ? (
          <div className="mb-6">
            <Skeleton className="h-4 w-20 mb-2" />
            <div className="flex gap-2 overflow-x-auto pb-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-32 flex-shrink-0 rounded-lg" />
              ))}
            </div>
          </div>
        ) : vehicles.length > 0 ? (
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">使用車両</label>
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {vehicles.map((v, i) => (
                <div
                  key={v.id}
                  ref={(el) => {
                    vehicleItemRefs.current[i] = el;
                  }}
                  className="flex-shrink-0"
                >
                  <VehiclePlate
                    vehicle={v}
                    selected={selectedVehicleId === v.id}
                    onClick={() => handleVehicleSelect(v, i)}
                    compact
                    className="w-36 sm:w-32"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1">タップで選択（前回の選択が保存されます）</p>
          </div>
        ) : (
          <div className="mb-4 text-xs text-slate-500">
            使用できる車両がまだ紐付けられていないため、車両選択とメーター入力欄は表示されません。
            管理者に連絡してください。
          </div>
        )}

        {/* メーター入力 */}
        {vehicles.length > 0 && (() => {
          const sel = selectedVehicleId ? vehicles.find((v) => v.id === selectedVehicleId) : null;
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
              <div className="flex items-center gap-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">メーター数値（km）</label>
                {showReminder && (
                  <button
                    type="button"
                    onClick={() => setOilReminderModal({ nextOilChangeKm })}
                    className={`inline-flex items-center gap-1 text-sm font-medium ${reminderColorClass} hover:opacity-80 transition-opacity`}
                    title="オイル交換時期のリマインド"
                  >
                    <FontAwesomeIcon icon={faCircleExclamation} className="w-4 h-4" />
                  </button>
                )}
              </div>
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
                className="w-full px-4 py-3 text-lg font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
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
              <div className="text-righttext-xs text-slate-500 space-y-0.5">
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
      </div>

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
    </>
  );
}
