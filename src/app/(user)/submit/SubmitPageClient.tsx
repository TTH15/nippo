"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleExclamation,
  faCrown,
  faMedal,
  faTriangleExclamation,
  faOilCan,
  faPhone,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { Skeleton } from "@/lib/components/Skeleton";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import { DatePicker } from "@/lib/components/DatePicker";
import { apiFetch } from "@/lib/api";
import { reportDateDefaultJST, reportDateStrToDate, dateToReportDateStr } from "@/lib/date";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

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

type DriverIdentity = {
  id: string;
  slot: number;
  driverCode: string;
  officeCode: string;
  label?: string;
};

function getInitialReportDate(): Date {
  return reportDateStrToDate(reportDateDefaultJST());
}

export default function SubmitPageClient() {
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
  const [meterError, setMeterError] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [todayReward, setTodayReward] = useState<number | null>(null);
  const [todayRewardLoading, setTodayRewardLoading] = useState(false);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [showVehicleSelector, setShowVehicleSelector] = useState(false);
  const [unlinkedVehicles, setUnlinkedVehicles] = useState<Vehicle[]>([]);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [confirmVehicle, setConfirmVehicle] = useState<Vehicle | null>(null);
  const [identities, setIdentities] = useState<DriverIdentity[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [shiftsToday, setShiftsToday] = useState<{ course_id: string; name: string; color: string }[]>([]);
  type MonthlyTotals = {
    yamato: {
      takuhaibinCompleted: number;
      takuhaibinReturned: number;
      nekoposCompleted: number;
      nekoposReturned: number;
    };
    amazon: {
      amMochidashi: number;
      amCompleted: number;
      pmMochidashi: number;
      pmCompleted: number;
      fourMochidashi: number;
      fourCompleted: number;
    };
  };
  type RankEntry = { rank: number; total: number } | null;
  type MonthlyRanks = {
    takuhaibinCompleted: RankEntry;
    nekoposCompleted: RankEntry;
    amazonAmCompleted: RankEntry;
    amazonPmCompleted: RankEntry;
    amazon4Completed: RankEntry;
  };
  const [monthlyTotals, setMonthlyTotals] = useState<MonthlyTotals | null>(null);
  const [monthlyRanks, setMonthlyRanks] = useState<MonthlyRanks | null>(null);
  const [monthlyTotalsLoading, setMonthlyTotalsLoading] = useState(false);
  const [oilReminderModal, setOilReminderModal] = useState<{
    nextOilChangeKm: number;
    oilProgress: number;
    lastOil: number;
    interval: number;
    currentKm: number;
    remaining: number;
    level: "warn" | "critical";
    mode: "optional" | "mandatory";
  } | null>(null);
  const [oilAcknowledged, setOilAcknowledged] = useState(false);
  const vehicleItemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const defaultReportDateRef = useRef(reportDateDefaultJST());
  useBodyScrollLock(showVehicleModal || oilReminderModal !== null);

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
          apiFetch<{
            name: string;
            officeCode: string;
            driverCode: string;
            identities?: DriverIdentity[];
          }>("/api/reports/profile").catch(() => null),
          apiFetch<{ vehicles: Vehicle[] }>("/api/reports/vehicles-unlinked", { cache: "no-store" }).catch(
            () => ({ vehicles: [] as Vehicle[] }),
          ),
        ]);
        const linkedVehicles = vehiclesRes.vehicles;
        const otherVehicles = unlinkedRes.vehicles ?? [];

        setVehicles(linkedVehicles);
        setUnlinkedVehicles(otherVehicles);
        if (profileRes) {
          const list = profileRes.identities ?? [];
          setIdentities(list);
          if (list.length > 0) {
            const stored =
              typeof window !== "undefined" ? localStorage.getItem("nippo_driver_identity_id") : null;
            const next = list.find((i) => i.id === stored) ?? list[0];
            setSelectedIdentityId(next.id);
          } else {
            setSelectedIdentityId(null);
          }
        }

        // 前回選択が「ドライバーに紐付いていない車両」の場合は、通常表示から外す
        // （「他の車両を選択」モーダル側で選び直せるようにする）
        const preferredId = prefRes.vehicleId;
        const preferredInLinked = preferredId ? linkedVehicles.some((v) => v.id === preferredId) : false;

        if (preferredInLinked && preferredId) {
          const idx = linkedVehicles.findIndex((v) => v.id === preferredId);
          setSelectedVehicleId(preferredId);
          setCarouselIndex(idx >= 0 ? idx : 0);
        } else if (linkedVehicles.length > 0) {
          setSelectedVehicleId(linkedVehicles[0].id);
          setCarouselIndex(0);
        } else {
          // 紐付け車両が無い場合は、まずは選択しない（モーダルで選択）
          setSelectedVehicleId(null);
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

  useEffect(() => {
    if (!selectedIdentityId) return;
    let cancelled = false;
    const run = async () => {
      try {
        const dateStr = dateToReportDateStr(reportDate);
        const res = await apiFetch<{
          report: Record<string, unknown> | null;
          shiftsToday: { course_id: string; name: string; color: string }[];
        }>(
          `/api/reports/day?reportDate=${encodeURIComponent(dateStr)}&driverIdentityId=${encodeURIComponent(selectedIdentityId)}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        setShiftsToday(res.shiftsToday ?? []);
        const r = res.report;
        if (r) {
          const car = r.carrier === "AMAZON" ? "AMAZON" : "YAMATO";
          setCarrier(car);
          if (car === "YAMATO") {
            setForm({
              takuhaibinCompleted: String(r.takuhaibin_completed ?? ""),
              takuhaibinReturned: String(r.takuhaibin_returned ?? ""),
              nekoposCompleted: String(r.nekopos_completed ?? ""),
              nekoposReturned: String(r.nekopos_returned ?? ""),
            });
          } else {
            setAmazonForm({
              amMochidashi: String(r.amazon_am_mochidashi ?? ""),
              amCompleted: String(r.amazon_am_completed ?? ""),
              pmMochidashi: String(r.amazon_pm_mochidashi ?? ""),
              pmCompleted: String(r.amazon_pm_completed ?? ""),
              fourMochidashi: String(r.amazon_4_mochidashi ?? ""),
              fourCompleted: String(r.amazon_4_completed ?? ""),
            });
          }
          const vid = r.vehicle_id as string | null | undefined;
          if (vid) {
            setSelectedVehicleId(vid);
            const all = [...vehicles, ...unlinkedVehicles];
            const idx = all.findIndex((v) => v.id === vid);
            if (idx >= 0) setCarouselIndex(idx);
          }
          if (r.meter_value != null) setMeterValue(String(r.meter_value));
          else setMeterValue("");
        } else {
          setCarrier("YAMATO");
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
          setMeterValue("");
        }
      } catch (e) {
        console.error(e);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [reportDate, selectedIdentityId, vehicles, unlinkedVehicles]);

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
    setMeterValue("");
    setMeterError("");
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

  const allKnownVehicles = Array.from(
    new Map([...vehicles, ...unlinkedVehicles].map((v) => [v.id, v] as const)).values(),
  );

  const getSelectedVehicle = () => {
    if (!selectedVehicleId) return null;
    return (
      allKnownVehicles.find((v) => v.id === selectedVehicleId) ??
      null
    );
  };

  const vehicleCandidates = allKnownVehicles.filter((v) =>
    selectedVehicleId ? v.id !== selectedVehicleId : true,
  );

  const computeOilStatus = (sel: Vehicle | null, meterStr: string) => {
    if (!sel) return null;
    const interval = Math.max(1, sel.oil_change_interval ?? 0);
    if (!sel.oil_change_interval || interval <= 0) return null;
    const lastOil = sel.last_oil_change_mileage ?? 0;
    const entered = meterStr === "" ? null : Number(meterStr);
    const currentKm =
      entered != null && Number.isFinite(entered) && entered > 0
        ? entered
        : sel.current_mileage || 0;
    const nextOilChangeKm = lastOil + interval;
    const remaining = nextOilChangeKm - currentKm;
    const oilProgress = Math.max(0, Math.min(100, ((currentKm - lastOil) / interval) * 100));
    let level: "safe" | "warn" | "critical" = "safe";
    if (remaining < 100) level = "critical";
    else if (remaining <= 300) level = "warn";
    return { lastOil, interval, currentKm, nextOilChangeKm, remaining, oilProgress, level };
  };

  const oilAckKey = useMemo(() => {
    if (!selectedVehicleId) return null;
    return `oilAck:${selectedVehicleId}:${dateToReportDateStr(reportDate)}`;
  }, [selectedVehicleId, reportDate]);

  useEffect(() => {
    if (!oilAckKey || typeof window === "undefined") {
      setOilAcknowledged(false);
      return;
    }
    setOilAcknowledged(sessionStorage.getItem(oilAckKey) === "1");
  }, [oilAckKey]);

  useEffect(() => {
    if (!selectedVehicleId) return;
    if (oilAcknowledged) return;
    if (oilReminderModal) return;
    const sel = getSelectedVehicle();
    const status = computeOilStatus(sel, meterValue);
    if (!status || status.level === "safe") return;
    setOilReminderModal({
      nextOilChangeKm: status.nextOilChangeKm,
      oilProgress: status.oilProgress,
      lastOil: status.lastOil,
      interval: status.interval,
      currentKm: status.currentKm,
      remaining: status.remaining,
      level: status.level,
      mode: "mandatory",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleId, meterValue, oilAcknowledged]);

  const acknowledgeOilReminder = () => {
    if (oilReminderModal?.mode === "mandatory" && oilAckKey && typeof window !== "undefined") {
      sessionStorage.setItem(oilAckKey, "1");
      setOilAcknowledged(true);
    }
    setOilReminderModal(null);
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
    setMeterValue("");
    setMeterError("");
    setShowVehicleModal(false);
    setConfirmVehicle(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    const sel = getSelectedVehicle();
    const prevKm = sel?.current_mileage ?? 0;
    const nextKm = meterValue ? Number(meterValue) : null;
    if (nextKm != null && prevKm > 0 && nextKm <= prevKm) {
      setMeterError(`前回のメーター数値（${prevKm.toLocaleString("ja-JP")} km）より大きい値を入力してください`);
      setStatus("idle");
      return;
    }

    const oilStatus = computeOilStatus(sel, meterValue);
    if (oilStatus && oilStatus.level !== "safe" && !oilAcknowledged) {
      setOilReminderModal({
        nextOilChangeKm: oilStatus.nextOilChangeKm,
        oilProgress: oilStatus.oilProgress,
        lastOil: oilStatus.lastOil,
        interval: oilStatus.interval,
        currentKm: oilStatus.currentKm,
        remaining: oilStatus.remaining,
        level: oilStatus.level === "critical" ? "critical" : "warn",
        mode: "mandatory",
      });
      setStatus("idle");
      return;
    }

    setStatus("loading");
    setMeterError("");

    if (!selectedIdentityId) {
      setStatus("error");
      setErrorMsg("勤務区分が読み込めていません。ページを再読み込みしてください。");
      return;
    }

    try {
      await apiFetch("/api/reports", {
        method: "POST",
        body: JSON.stringify({
          driverIdentityId: selectedIdentityId,
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
          meterValue: nextKm,
        }),
      });
      if (selectedVehicleId) saveVehiclePreference(selectedVehicleId);
      setStatus("success");
      if (selectedIdentityId) {
        setTodayRewardLoading(true);
        setMonthlyTotalsLoading(true);
        const dateStr = dateToReportDateStr(reportDate);
        const idParam = encodeURIComponent(selectedIdentityId);
        const dateParam = encodeURIComponent(dateStr);
        const rewardPromise = apiFetch<{ reward: number }>(
          `/api/reports/today-reward?reportDate=${dateParam}&driverIdentityId=${idParam}`,
          { cache: "no-store" },
        )
          .then((res) => setTodayReward(Number(res.reward) || 0))
          .catch((e) => {
            console.error(e);
            setTodayReward(null);
          })
          .finally(() => setTodayRewardLoading(false));
        const monthlyPromise = apiFetch<{ totals: MonthlyTotals; ranks: MonthlyRanks }>(
          `/api/reports/monthly-totals?reportDate=${dateParam}&driverIdentityId=${idParam}`,
          { cache: "no-store" },
        )
          .then((res) => {
            setMonthlyTotals(res.totals);
            setMonthlyRanks(res.ranks);
          })
          .catch((e) => {
            console.error(e);
            setMonthlyTotals(null);
            setMonthlyRanks(null);
          })
          .finally(() => setMonthlyTotalsLoading(false));
        await Promise.all([rewardPromise, monthlyPromise]);
      } else {
        setTodayReward(null);
        setTodayRewardLoading(false);
        setMonthlyTotals(null);
        setMonthlyRanks(null);
        setMonthlyTotalsLoading(false);
      }
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "送信に失敗しました");
    }
  };

  const yamatoFields: { key: keyof typeof form; label: string; sub: string }[] = [
    { key: "takuhaibinCompleted", label: "宅急便", sub: "完了" },
    { key: "takuhaibinReturned", label: "宅急便", sub: "持戻" },
    { key: "nekoposCompleted", label: "ネコポス", sub: "完了" },
    { key: "nekoposReturned", label: "ネコポス", sub: "持戻" },
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

  if (status === "success") {
    const monthLabel = `${reportDate.getFullYear()}年${reportDate.getMonth() + 1}月`;
    const ym = monthlyTotals;
    const rk = monthlyRanks;

    type CategoryRow = {
      label: string;
      count: number;
      rank: RankEntry;
    };
    const categories: CategoryRow[] = carrier === "AMAZON"
      ? [
          {
            label: "午前 完了",
            count: ym?.amazon.amCompleted ?? 0,
            rank: rk?.amazonAmCompleted ?? null,
          },
          {
            label: "午後 完了",
            count: ym?.amazon.pmCompleted ?? 0,
            rank: rk?.amazonPmCompleted ?? null,
          },
          {
            label: "4便 完了",
            count: ym?.amazon.fourCompleted ?? 0,
            rank: rk?.amazon4Completed ?? null,
          },
        ]
      : [
          {
            label: "宅急便 完了",
            count: ym?.yamato.takuhaibinCompleted ?? 0,
            rank: rk?.takuhaibinCompleted ?? null,
          },
          {
            label: "ネコポス 完了",
            count: ym?.yamato.nekoposCompleted ?? 0,
            rank: rk?.nekoposCompleted ?? null,
          },
        ];

    const rankIcon = (rank: number): { icon: IconDefinition; colorClass: string } | null => {
      if (rank === 1) return { icon: faCrown, colorClass: "text-amber-500" };
      if (rank === 2) return { icon: faMedal, colorClass: "text-slate-400" };
      if (rank === 3) return { icon: faMedal, colorClass: "text-amber-700" };
      return null;
    };

    return (
      <div className="max-w-sm mx-auto mt-12 px-4 pb-12">
        <div className="text-center mb-6">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">送信完了</h2>
          <p className="text-sm text-slate-500 mb-6">本日の日報を提出しました</p>
        </div>

        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs text-slate-500">今日の日当（見込み）</p>
          <p className="mt-1 text-3xl font-bold text-slate-900 tabular-nums">
            {todayRewardLoading ? "計算中..." : `${(todayReward ?? 0).toLocaleString("ja-JP")}円`}
          </p>
          <p className="mt-2 text-sm text-slate-600">今日も一日お疲れ様でした！</p>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500 text-center mb-3">{monthLabel} の累計個数</p>
          {monthlyTotalsLoading ? (
            <p className="mt-1 text-center text-sm text-slate-500">集計中...</p>
          ) : (
            <div className="space-y-2">
              {categories.map((c) => (
                <div
                  key={c.label}
                  className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"
                >
                  <div className="text-sm text-slate-600">{c.label}</div>
                  <div className="flex items-baseline gap-3">
                    <div className="text-2xl font-bold text-slate-900 tabular-nums">
                      {c.count.toLocaleString("ja-JP")}
                      <span className="text-xs font-medium text-slate-500 ml-0.5">個</span>
                    </div>
                    {c.rank ? (() => {
                      const ic = rankIcon(c.rank.rank);
                      return (
                        <div className="text-xs text-slate-700 tabular-nums whitespace-nowrap inline-flex items-center gap-1">
                          {ic && (
                            <FontAwesomeIcon
                              icon={ic.icon}
                              className={`w-3.5 h-3.5 ${ic.colorClass}`}
                            />
                          )}
                          <span>
                            <span className="font-bold text-slate-900">{c.rank.rank}</span>
                            <span className="text-slate-400">/{c.rank.total}</span>
                            <span className="text-slate-500 ml-0.5">位</span>
                          </span>
                        </div>
                      );
                    })() : (
                      <div className="text-xs text-slate-400 whitespace-nowrap">—</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
              setTodayReward(null);
              setTodayRewardLoading(false);
              setMonthlyTotals(null);
              setMonthlyRanks(null);
              setMonthlyTotalsLoading(false);
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
      <h1 className="text-lg font-bold text-brand-900 mb-4">日報送信</h1>

      {identities.length > 1 && (
        <div className="mb-4 flex gap-2 flex-wrap">
          {identities.map((idn) => (
            <button
              key={idn.id}
              type="button"
              onClick={() => {
                setSelectedIdentityId(idn.id);
                if (typeof window !== "undefined") {
                  localStorage.setItem("nippo_driver_identity_id", idn.id);
                }
              }}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                selectedIdentityId === idn.id
                  ? "bg-brand-800 text-white border-brand-800"
                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
              }`}
            >
              区分{idn.slot}（{idn.driverCode}）
            </button>
          ))}
        </div>
      )}

      {shiftsToday.length > 0 && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-xs font-medium text-slate-600 mb-1.5">この日の担当コース（シフト）</p>
          <div className="flex flex-wrap gap-1.5">
            {shiftsToday.map((s) => (
              <span
                key={s.course_id}
                className="px-2 py-0.5 rounded text-xs text-white"
                style={{ backgroundColor: s.color }}
              >
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

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

      {/* 車両選択（通常表示は「紐付けられた車両」すべて） */}
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

          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                {vehicles.map((v, i) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => handleVehicleSelect(v, i)}
                    className={`flex-shrink-0 w-52 sm:w-52 rounded-lg border ${selectedVehicleId === v.id
                      ? "border-slate-900"
                      : "border-slate-200 hover:border-slate-400"
                      } bg-white px-1 pt-1 pb-2`}
                  >
                    <div className="w-[200px] mx-auto">
                      <VehiclePlate
                        vehicle={v}
                        selected={selectedVehicleId === v.id}
                        glow={false}
                        className="w-full max-w-[200px]"
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowVehicleModal(true);
                setShowVehicleSelector(true);
                // モーダル内の候補は「選択中以外」なので、先頭に寄せる
                setCarouselIndex(0);
                setConfirmVehicle(null);
              }}
              className="shrink-0 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
            >
              他の車両を選択
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-6">
          <div className="mb-2 text-xs text-slate-500">
            {unlinkedVehicles.length > 0
              ? "紐付けられた車両がありません。必要に応じて「他の車両を選択」から選べます。"
              : "使用できる車両がまだ紐付けられていないため、メーター入力欄は表示されません。管理者に連絡してください。"}
          </div>

          {unlinkedVehicles.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowVehicleModal(true);
                setShowVehicleSelector(true);
                setCarouselIndex(0);
                setConfirmVehicle(null);
              }}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
            >
              他の車両を選択
            </button>
          )}
        </div>
      )}

      {/* メーター入力 */}
      {(vehicles.length > 0 || (selectedVehicleId && getSelectedVehicle())) && (() => {
        const sel = getSelectedVehicle();
        const oilStatus = computeOilStatus(sel, meterValue);
        const showReminder = oilStatus !== null && oilStatus.level !== "safe";
        const isRed = oilStatus?.level === "critical";
        const reminderColorClass = isRed ? "text-red-500" : "text-yellow-500";
        const prevKm = sel?.current_mileage ?? 0;
        const isMeterInvalid = meterValue !== "" && prevKm > 0 && Number(meterValue) <= prevKm;
        const placeholder =
          prevKm > 0 ? `前回: ${prevKm.toLocaleString("ja-JP")} km` : "例: 14567";

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
                placeholder={placeholder}
                value={meterValue}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  setMeterValue(v);
                  if (v === "") {
                    setMeterError("");
                    return;
                  }
                  const nextKm = Number(v);
                  if (prevKm > 0 && nextKm <= prevKm) {
                    setMeterError(
                      `前回のメーター数値（${prevKm.toLocaleString("ja-JP")} km）より大きい値を入力してください`,
                    );
                  } else {
                    setMeterError("");
                  }
                }}
                className={`w-full py-3 text-lg font-mono border rounded-xl focus:outline-none focus:ring-2 ${isMeterInvalid ? "border-red-400 focus:ring-red-200" : "border-slate-200 focus:ring-brand-500"
                  } ${showReminder ? "pl-4 pr-10" : "px-4"}`}
              />
              {showReminder && oilStatus && (
                <button
                  type="button"
                  onClick={() =>
                    setOilReminderModal({
                      nextOilChangeKm: oilStatus.nextOilChangeKm,
                      oilProgress: oilStatus.oilProgress,
                      lastOil: oilStatus.lastOil,
                      interval: oilStatus.interval,
                      currentKm: oilStatus.currentKm,
                      remaining: oilStatus.remaining,
                      level: oilStatus.level === "critical" ? "critical" : "warn",
                      mode: "optional",
                    })
                  }
                  className={`absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-8 h-8 rounded-lg ${reminderColorClass} hover:opacity-80 transition-opacity`}
                  title="オイル交換時期のリマインド"
                >
                  <FontAwesomeIcon icon={faCircleExclamation} className="w-5 h-5" />
                </button>
              )}
            </div>
            {meterError ? (
              <p className="text-xs text-red-600 mt-1">{meterError}</p>
            ) : (
              <p className="text-xs text-slate-500 mt-1">車両のメーター数値として記録されます</p>
            )}
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
        同日・同一勤務区分の再送信は上書きされます（ヤマト / Amazon 共通）
      </p>

      {/* 他の車両選択モーダル（選択中以外の車両） */}
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
              使用した車両を選択してください。
            </p>

            {vehicleCandidates.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                選択できる車両がありません。
              </p>
            ) : (
              <>
                <div className="flex items-center overflow-x-auto pb-2 scrollbar-hide mb-3">
                  {vehicleCandidates.map((v, i) => (
                    <div
                      key={v.id}
                      ref={(el) => {
                        vehicleItemRefs.current[i] = el;
                      }}
                      className="flex-shrink-0 w-52 sm:w-52"
                    >
                      <button
                        type="button"
                        onClick={() => handleUnlinkedSelect(v)}
                        className={`w-full rounded-lg border ${confirmVehicle?.id === v.id
                          ? "border-slate-900"
                          : "border-slate-200 hover:border-slate-400"
                          } bg-white px-1 pt-1 pb-2`}
                      >
                        <div className="w-[200px] mx-auto">
                          <VehiclePlate vehicle={v} glow={false} className="w-full max-w-[200px]" />
                        </div>
                        {(v.manufacturer || v.brand) && (
                          <div className="text-[10px] text-slate-500 truncate text-center">
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
                      この車両で正しいですか？
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
      {oilReminderModal && (() => {
        const isCritical = oilReminderModal.level === "critical";
        const isMandatory = oilReminderModal.mode === "mandatory";
        const remaining = oilReminderModal.remaining;
        const overdueKm = remaining < 0 ? Math.abs(remaining) : 0;
        const headerClass = isCritical ? "text-red-600" : "text-yellow-600";
        const gaugeColorClass = isCritical ? "bg-red-500" : "bg-yellow-400";
        const gaugeMarkerClass = isCritical ? "text-red-500" : "text-yellow-400";
        const buttonClass = isCritical
          ? "bg-red-600 hover:bg-red-500"
          : "bg-slate-800 hover:bg-slate-700";
        return (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => {
              if (!isMandatory) setOilReminderModal(null);
            }}
          >
            <div
              className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              {/* ヘッダー */}
              <div className="text-center">
                <div className={`inline-flex items-center gap-1.5 text-sm font-semibold ${headerClass}`}>
                  <FontAwesomeIcon
                    icon={isCritical ? faCircleExclamation : faTriangleExclamation}
                    className="w-4 h-4"
                  />
                  {isCritical ? "オイル交換期限を超過しています" : "オイル交換が近づいています"}
                </div>
                {isCritical ? (
                  overdueKm > 0 ? (
                    <p className="mt-2 text-sm text-slate-800">
                      期限を <span className="font-bold text-red-600">{overdueKm.toLocaleString("ja-JP")} km</span> 超過しています。
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-800">
                      残り <span className="font-bold text-red-600">{Math.max(0, remaining).toLocaleString("ja-JP")} km</span> です。ただちに交換してください。
                    </p>
                  )
                ) : (
                  <p className="mt-2 text-sm text-slate-800">
                    残り <span className="font-bold text-yellow-700">{remaining.toLocaleString("ja-JP")} km</span> で交換時期です。
                  </p>
                )}
              </div>

              {/* ゲージ */}
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
                <div className="relative h-3">
                  {(() => {
                    const percent = Math.min(Math.max(oilReminderModal.oilProgress, 0), 100);
                    return (
                      <div
                        className={`absolute top-0 z-10 text-[10px] leading-none ${gaugeMarkerClass}`}
                        style={{ left: `${percent}%`, transform: "translateX(-50%)" }}
                      >
                        ▼
                      </div>
                    );
                  })()}
                </div>
                <div className="relative h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  {(() => {
                    const percent = Math.min(Math.max(oilReminderModal.oilProgress, 0), 100);
                    return (
                      <div
                        className={`absolute top-0 left-0 h-full rounded-full transition-all ${gaugeColorClass}`}
                        style={{ width: `${percent}%` }}
                      />
                    );
                  })()}
                </div>
                <div className="mt-2 text-center text-[11px] text-slate-500">
                  現在走行距離 {oilReminderModal.currentKm.toLocaleString("ja-JP")} km（交換目安: {oilReminderModal.interval.toLocaleString("ja-JP")} km）
                </div>
              </div>

              {/* 影響の周知 */}
              <div className={`mt-5 rounded-lg border p-3 ${isCritical ? "border-red-200 bg-red-50" : "border-yellow-200 bg-yellow-50"}`}>
                <div className={`inline-flex items-center gap-1.5 text-xs font-semibold mb-1 ${isCritical ? "text-red-700" : "text-yellow-800"}`}>
                  <FontAwesomeIcon icon={faOilCan} className="w-3.5 h-3.5" />
                  オイル交換を怠ると…
                </div>
                <ul className="text-[11px] text-slate-700 space-y-1 leading-snug list-disc pl-4">
                  {isCritical ? (
                    <>
                      <li>エンジン焼き付きのリスクが高まります</li>
                      <li>保険・保証の対象外となる場合があります</li>
                      <li>走行中の故障で配送業務が停止する可能性があります</li>
                      <li>修理費が <span className="font-bold">50万円以上</span> 発生するケースがあります</li>
                    </>
                  ) : (
                    <>
                      <li>エンジン内部の摩耗が急速に進みます</li>
                      <li>燃費が悪化し、燃料コストが増加します</li>
                      <li>放置すると最悪エンジン故障で <span className="font-bold">高額な修理費</span> が発生します</li>
                    </>
                  )}
                </ul>
                {isCritical && (
                  <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-red-700 font-semibold">
                    <FontAwesomeIcon icon={faPhone} className="w-3 h-3" />
                    至急、管理者へ報告し交換手配をしてください。
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={acknowledgeOilReminder}
                className={`mt-4 w-full py-2.5 text-white text-sm font-semibold rounded-lg transition-colors ${buttonClass}`}
              >
                {isMandatory ? "了解しました" : "閉じる"}
              </button>
              {isMandatory && (
                <p className="mt-2 text-[10px] text-slate-500 text-center">
                  ※ 内容を確認してから日報を送信してください
                </p>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

