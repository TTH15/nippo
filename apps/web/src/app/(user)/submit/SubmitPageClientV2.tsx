"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faTriangleExclamation,
  faCircleExclamation,
  faOilCan,
  faPhone,
} from "@fortawesome/free-solid-svg-icons";
import { Skeleton } from "@/lib/components/Skeleton";
import { DatePicker } from "@/lib/components/DatePicker";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import { PostSubmitView, type SubmitScreen } from "@/lib/components/PostSubmitView";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { reportDateDefaultJST, reportDateStrToDate, dateToReportDateStr } from "@/lib/date";
import { evaluateMeter } from "./submitFormUtils";
import type { DriverIdentity, SubmitVehicle as Vehicle, UnitDef, ShiftForm, ValueMap } from "@/core/types";
import { formatMonthDayJP } from "@/core/logic/calendar";
import { computeOilStatus, type OilLevel } from "@/core/logic/oilChange";
import {
  buildInitialValues,
  parseMeter,
  resolveDefaultVehicleId,
  resolveExistingMeter,
  findVehicle,
  buildReportItems,
  buildVehicleCards,
  groupFieldsByLabel,
} from "@/core/logic/dailyReport";

// ============================================================
// 動的日報フォーム（新モデル）。
//   その日のシフト(=コース)ごとに、キャリア配下の unit と報告項目を動的描画。
//   複数シフト（昼ヤマト＋夜Amazon等）は複数カードで表示し、まとめて送信。
//   送信は POST /api/reports/v2（daily_reports_v2 + report_entries）。
//   ドメインロジックは @/core/logic/dailyReport に集約（純粋・テスト付き）。
// 注: 旧 SubmitPageClient とは別ファイル。ルートは page.tsx で切替。
// ============================================================

export default function SubmitPageClientV2() {
  const [reportDate, setReportDate] = useState<Date>(() => reportDateStrToDate(reportDateDefaultJST()));
  const [identities, setIdentities] = useState<DriverIdentity[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [unlinkedVehicles, setUnlinkedVehicles] = useState<Vehicle[]>([]);
  const [showOtherVehicles, setShowOtherVehicles] = useState(false);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  // その日のシフトで割り当てられた車両（先頭サジェスト用）。廃車はサーバ側でnull化済み。
  const [shiftVehicleId, setShiftVehicleId] = useState<string | null>(null);
  const [meter, setMeter] = useState<string>("");
  // 走行距離(メーター)の必須エラーを送信試行時に表示するフラグ
  const [meterRequiredError, setMeterRequiredError] = useState(false);

  // オイル交換リマインド。warn/critical の車両を選択中に自動表示（必須確認）し、
  // メーター入力欄の警告アイコンからも開ける（任意）。
  type OilReminder = {
    lastOil: number;
    interval: number;
    currentKm: number;
    nextOilChangeKm: number;
    remaining: number;
    oilProgress: number;
    level: Exclude<OilLevel, "safe">;
    mode: "mandatory" | "optional";
  };
  const [oilReminderModal, setOilReminderModal] = useState<OilReminder | null>(null);
  const [oilAcknowledged, setOilAcknowledged] = useState(false);

  const [postSubmit, setPostSubmit] = useState<SubmitScreen | null>(null);

  const [shifts, setShifts] = useState<ShiftForm[]>([]);
  const [values, setValues] = useState<ValueMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // プロフィール（勤務区分）・車両（紐付け＋その他）
  // プロフィール/車両を SWR キャッシュ（遷移をまたいで保持＝再訪時の点滅をなくす）。
  // 選択中の identity が裏更新で変わらないようフォーカス再検証は無効化。
  const { data: initData, isInitialLoading: loading } = useApi<{
    identities: DriverIdentity[];
    vehicles: Vehicle[];
    unlinked: Vehicle[];
  }>("me/submit-init", {
    revalidateOnFocus: false,
    fetcher: async () => {
      const [profile, vehiclesRes, unlinkedRes] = await Promise.all([
        apiFetch<{ identities?: DriverIdentity[] }>("/api/reports/profile").catch(() => null),
        apiFetch<{ vehicles: Vehicle[] }>("/api/reports/vehicles", { cache: "no-store" }).catch(() => ({ vehicles: [] })),
        apiFetch<{ vehicles: Vehicle[] }>("/api/reports/vehicles-unlinked", { cache: "no-store" }).catch(() => ({ vehicles: [] })),
      ]);
      return {
        identities: profile?.identities ?? [],
        vehicles: vehiclesRes.vehicles ?? [],
        unlinked: unlinkedRes.vehicles ?? [],
      };
    },
  });

  useEffect(() => {
    if (!initData) return;
    setIdentities(initData.identities);
    if (initData.identities.length > 0) {
      setSelectedIdentityId((prev) => prev ?? initData.identities[0].id);
    }
    setVehicles(initData.vehicles);
    setUnlinkedVehicles(initData.unlinked);
  }, [initData]);

  // 日付ごとの動的フォーム。SWR でキャッシュしつつ、入力中(values)を裏更新で壊さない。
  const reportFormDateStr = dateToReportDateStr(reportDate);
  const {
    data: formData,
    error: formError,
    isInitialLoading: formLoading,
  } = useApi<{ shifts: ShiftForm[]; shiftVehicleId?: string | null }>(
    `/api/me/report-form?date=${encodeURIComponent(reportFormDateStr)}`,
    { revalidateOnFocus: false },
  );

  // 同一日付では再初期化しない（バックグラウンド再検証で入力を消さないため）。
  const initializedDateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!formData) return;
    if (initializedDateRef.current === reportFormDateStr) return;
    initializedDateRef.current = reportFormDateStr;
    const list = formData.shifts ?? [];
    setShifts(list);
    // 既存値で初期化
    setValues(buildInitialValues(list));
    // 既定車両: その日のシフト割当車両を最優先 > 既存report の車両。メーターは既存report のみ。
    setShiftVehicleId(formData.shiftVehicleId ?? null);
    setVehicleId(resolveDefaultVehicleId(list, formData.shiftVehicleId ?? null));
    setMeter(resolveExistingMeter(list));
  }, [formData, reportFormDateStr]);

  useEffect(() => {
    if (formError) setShifts([]);
  }, [formError]);

  // 送信フォーム上部の注意バナー（運営設定・期間判定はサーバ側）。
  const { data: noticeData } = useApi<{ notice: { message: string } | null }>("/api/me/form-notice");
  const formNotice = noticeData?.notice ?? null;

  // シフト提出締切のリマインド（本人の締切ルールから自動算出。締切が近いときだけ返る）。
  const { data: reminderData } = useApi<{
    reminder: { deadline: string; daysLeft: number; label: string } | null;
  }>("/api/me/shift-deadline-reminder");
  const deadlineReminder = reminderData?.reminder ?? null;

  function setVal(courseId: string, unitId: string, fieldKey: string, v: string) {
    setValues((prev) => ({
      ...prev,
      [courseId]: { ...prev[courseId], [unitId]: { ...prev[courseId]?.[unitId], [fieldKey]: v } },
    }));
  }

  const meterNum = useMemo(() => parseMeter(meter), [meter]);

  // 選択車両のオイル交換状況（入力中メーターを先読み反映）。
  const selectedVehicle = useMemo(
    () => findVehicle(vehicles, unlinkedVehicles, vehicleId),
    [vehicles, unlinkedVehicles, vehicleId],
  );
  const oilStatus = useMemo(
    () => computeOilStatus(selectedVehicle, meter),
    [selectedVehicle, meter],
  );

  // 確認は「車両×日付」単位で1度だけ強制（同セッション内）。
  const oilAckKey = useMemo(
    () => (vehicleId ? `oilAck:${vehicleId}:${dateToReportDateStr(reportDate)}` : null),
    [vehicleId, reportDate],
  );
  useEffect(() => {
    if (!oilAckKey || typeof window === "undefined") {
      setOilAcknowledged(false);
      return;
    }
    setOilAcknowledged(sessionStorage.getItem(oilAckKey) === "1");
  }, [oilAckKey]);

  // warn/critical の車両を選んだら、未確認のうちは確認モーダルを自動表示。
  useEffect(() => {
    if (oilAcknowledged || oilReminderModal) return;
    if (!oilStatus || oilStatus.level === "safe") return;
    setOilReminderModal({
      lastOil: oilStatus.lastOil,
      interval: oilStatus.interval,
      currentKm: oilStatus.currentKm,
      nextOilChangeKm: oilStatus.nextOilChangeKm,
      remaining: oilStatus.remaining,
      oilProgress: oilStatus.oilProgress,
      level: oilStatus.level,
      mode: "mandatory",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oilStatus, oilAcknowledged]);

  function acknowledgeOilReminder() {
    if (oilReminderModal?.mode === "mandatory" && oilAckKey && typeof window !== "undefined") {
      sessionStorage.setItem(oilAckKey, "1");
      setOilAcknowledged(true);
    }
    setOilReminderModal(null);
  }

  async function submit() {
    // 走行距離の妥当性（未入力・前回値以下）を判定。表示と同一ロジックで送信もブロックする。
    const selVehicle = findVehicle(vehicles, unlinkedVehicles, vehicleId);
    const meterState = evaluateMeter(meter, selVehicle);
    if (!meterState.canSubmit) {
      setMeterRequiredError(true);
      setMessage({
        kind: "err",
        text: meterState.missing
          ? "走行距離を入力してください"
          : `走行距離は前回（${meterState.prevKm.toLocaleString("ja-JP")} km）より大きい値を入力してください`,
      });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const items = buildReportItems(shifts, values, vehicleId, meterNum);

      await apiFetch("/api/reports/v2", {
        method: "POST",
        body: JSON.stringify({
          reportDate: dateToReportDateStr(reportDate),
          driverIdentityId: selectedIdentityId,
          items,
        }),
      });
      setMessage({ kind: "ok", text: "日報を送信しました。" });
      // 送信後画面（今日の報酬見込み＋ランキング）
      try {
        const ps = await apiFetch<SubmitScreen>(
          `/api/me/submit-screen?date=${encodeURIComponent(dateToReportDateStr(reportDate))}`,
        );
        setPostSubmit(ps);
      } catch {
        /* 送信後画面の取得失敗は致命的でない */
      }
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : "送信に失敗しました" });
    } finally {
      setSubmitting(false);
    }
  }

  if (postSubmit) {
    return <PostSubmitView data={postSubmit} onClose={() => setPostSubmit(null)} />;
  }

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-4 py-6 space-y-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-5">
      <h1 className="text-lg font-semibold text-slate-900">日報入力</h1>

      {deadlineReminder && (
        <div
          role="alert"
          className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${
            deadlineReminder.daysLeft <= 2
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-sky-200 bg-sky-50 text-sky-900"
          }`}
        >
          <FontAwesomeIcon icon={faCalendarDays} aria-hidden className="shrink-0" />
          <p className="leading-relaxed">
            シフト提出は <span className="font-semibold">{formatMonthDayJP(deadlineReminder.deadline)}</span> まで
            <span className="ml-1 font-semibold">
              （{deadlineReminder.daysLeft === 0 ? "本日締切" : `あと${deadlineReminder.daysLeft}日`}）
            </span>
          </p>
        </div>
      )}

      {formNotice && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
        >
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden className="mt-0.5 shrink-0 text-amber-500" />
          <p className="whitespace-pre-wrap leading-relaxed">{formNotice.message}</p>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">日付</label>
          <DatePicker value={reportDate} onChange={(d) => d && setReportDate(d)} />
        </div>

        {identities.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">勤務区分</label>
            <select value={selectedIdentityId ?? ""} onChange={(e) => setSelectedIdentityId(e.target.value)} className="w-full px-2 py-2 border border-slate-300 rounded">
              {identities.map((i) => (
                <option key={i.id} value={i.id}>{i.label || i.driverCode}（{i.officeCode}）</option>
              ))}
            </select>
          </div>
        )}

        {/* 車両選択（カード式。紐付け車両＋当日シフト割当＋他の車両も選択可） */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">使用車両</label>
          {(() => {
            const { cards, linkedIds, hasMoreOthers } = buildVehicleCards({
              vehicles,
              unlinked: unlinkedVehicles,
              vehicleId,
              shiftVehicleId,
              showOtherVehicles,
            });
            return (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                {cards.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVehicleId(v.id)}
                    className={`flex-shrink-0 w-48 rounded-lg border bg-white px-1 pt-1 pb-1 transition-colors ${
                      vehicleId === v.id ? "border-slate-900" : "border-slate-200 hover:border-slate-400"
                    }`}
                  >
                    <div className="w-[180px] mx-auto">
                      <VehiclePlate vehicle={v} selected={vehicleId === v.id} className="w-full max-w-[180px]" />
                    </div>
                    {v.id === shiftVehicleId ? (
                      <div className="text-[10px] text-brand-600 font-medium text-center leading-none mt-0.5">シフト車両</div>
                    ) : !linkedIds.has(v.id) ? (
                      <div className="text-[10px] text-slate-400 text-center leading-none mt-0.5">他の車両</div>
                    ) : null}
                  </button>
                ))}
                {/* 他の車両を選択（未紐付け車両を展開） */}
                {hasMoreOthers && (
                  <button
                    type="button"
                    onClick={() => setShowOtherVehicles(true)}
                    className="flex-shrink-0 w-28 min-h-[3.5rem] rounded-lg border border-dashed border-slate-300 text-xs font-medium text-slate-500 hover:border-slate-400"
                  >
                    ＋ 他の車両
                    <br />
                    を選択
                  </button>
                )}
                {/* 車両なしで続ける */}
                <button
                  type="button"
                  onClick={() => setVehicleId(null)}
                  className={`flex-shrink-0 w-28 min-h-[3.5rem] rounded-lg border text-sm font-medium transition-colors ${
                    vehicleId === null
                      ? "border-slate-900 bg-slate-50 text-slate-900"
                      : "border-dashed border-slate-300 text-slate-500 hover:border-slate-400"
                  }`}
                >
                  車両なしで
                  <br />
                  続ける
                </button>
              </div>
            );
          })()}
        </div>

        {/* メーター（車両選択あり & EV でない時のみ） */}
        {(() => {
          const sel = findVehicle(vehicles, unlinkedVehicles, vehicleId);
          if (!sel || sel.is_ev) return null;
          const meterState = evaluateMeter(meter, sel);
          const prevKm = meterState.prevKm;
          const placeholder = prevKm > 0 ? `前回: ${prevKm.toLocaleString("ja-JP")} km` : "例: 14567";
          const invalid = meterState.belowPrev;
          const missing = meterRequiredError && meterState.missing;
          const showOilReminder = oilStatus != null && oilStatus.level !== "safe";
          const oilIsCritical = oilStatus?.level === "critical";
          return (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                走行距離（km）<span className="text-red-500 ml-0.5">*</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder={placeholder}
                  value={meter}
                  onChange={(e) => {
                    setMeter(e.target.value.replace(/\D/g, ""));
                    if (meterRequiredError) setMeterRequiredError(false);
                  }}
                  className={`w-full py-3 text-lg font-mono border rounded-xl focus:outline-none focus:ring-2 ${
                    invalid || missing ? "border-red-400 focus:ring-red-200" : "border-slate-200 focus:ring-brand-500"
                  } ${showOilReminder ? "pl-4 pr-11" : "px-4"}`}
                />
                {showOilReminder && oilStatus && (
                  <button
                    type="button"
                    onClick={() =>
                      setOilReminderModal({
                        lastOil: oilStatus.lastOil,
                        interval: oilStatus.interval,
                        currentKm: oilStatus.currentKm,
                        nextOilChangeKm: oilStatus.nextOilChangeKm,
                        remaining: oilStatus.remaining,
                        oilProgress: oilStatus.oilProgress,
                        level: oilStatus.level === "critical" ? "critical" : "warn",
                        mode: "optional",
                      })
                    }
                    className={`absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-8 h-8 rounded-lg transition-opacity hover:opacity-80 ${
                      oilIsCritical ? "text-red-500" : "text-yellow-500"
                    }`}
                    title="オイル交換時期のリマインド"
                  >
                    <FontAwesomeIcon icon={faCircleExclamation} className="w-5 h-5" />
                  </button>
                )}
              </div>
              {missing ? (
                <p className="mt-1 text-xs text-red-500">！走行距離を入力してください</p>
              ) : invalid ? (
                <p className="mt-1 text-xs text-red-500">
                  前回（{prevKm.toLocaleString("ja-JP")} km）より大きい値を入力してください
                </p>
              ) : null}
            </div>
          );
        })()}
      </div>

      {formLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : shifts.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">この日のシフトがありません。</p>
      ) : (
        <div className="space-y-4">
          {shifts.map((s) => (
            <div key={s.courseId} className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color ?? "#94a3b8" }} />
                <span className="font-medium text-slate-800">{s.courseName}</span>
                {s.carrierName && <span className="text-[11px] text-slate-400">{s.carrierName}</span>}
              </div>
              <div className="px-4 py-3 space-y-4">
                {s.units.length === 0 && <p className="text-xs text-slate-400">報告項目が設定されていません。</p>}
                {s.units.map((u) => (
                  <UnitFields key={u.id} unit={u} courseId={s.courseId} values={values} setVal={setVal} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {message && (
        <div className={`text-sm rounded px-3 py-2 ${message.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{message.text}</div>
      )}

      <button
        type="button"
        disabled={submitting || shifts.length === 0}
        onClick={submit}
        className="w-full py-3 rounded-lg bg-slate-900 text-white font-medium disabled:opacity-50"
      >
        {submitting ? "送信中…" : "送信"}
      </button>

      {/* オイル交換リマインドモーダル */}
      {oilReminderModal && (() => {
        const isCritical = oilReminderModal.level === "critical";
        const isMandatory = oilReminderModal.mode === "mandatory";
        const remaining = oilReminderModal.remaining;
        const overdueKm = remaining < 0 ? Math.abs(remaining) : 0;
        const headerClass = isCritical ? "text-red-600" : "text-yellow-600";
        const gaugeColorClass = isCritical ? "bg-red-500" : "bg-yellow-400";
        const gaugeMarkerClass = isCritical ? "text-red-500" : "text-yellow-400";
        const buttonClass = isCritical ? "bg-red-600 hover:bg-red-500" : "bg-slate-800 hover:bg-slate-700";
        const percent = Math.min(Math.max(oilReminderModal.oilProgress, 0), 100);
        return (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => {
              if (!isMandatory) setOilReminderModal(null);
            }}
          >
            <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
              {/* ヘッダー */}
              <div className="text-center">
                <div className={`inline-flex items-center gap-1.5 text-sm font-semibold ${headerClass}`}>
                  <FontAwesomeIcon icon={isCritical ? faCircleExclamation : faTriangleExclamation} className="w-4 h-4" />
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
                  <div
                    className={`absolute top-0 z-10 text-[10px] leading-none ${gaugeMarkerClass}`}
                    style={{ left: `${percent}%`, transform: "translateX(-50%)" }}
                  >
                    ▼
                  </div>
                </div>
                <div className="relative h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`absolute top-0 left-0 h-full rounded-full transition-all ${gaugeColorClass}`}
                    style={{ width: `${percent}%` }}
                  />
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

function UnitFields({
  unit,
  courseId,
  values,
  setVal,
}: {
  unit: UnitDef;
  courseId: string;
  values: ValueMap;
  setVal: (courseId: string, unitId: string, fieldKey: string, v: string) => void;
}) {
  // group_label でグルーピング（null はグループなし）
  const groups = groupFieldsByLabel(unit.fields);

  return (
    <div>
      <div className="text-sm font-medium text-slate-700 mb-1.5">{unit.name}</div>
      <div className="space-y-2">
        {groups.map(([groupKey, fields]) => (
          <div key={groupKey}>
            {groupKey && <div className="text-[11px] text-indigo-600 mb-1">{groupKey}</div>}
            <div className="grid grid-cols-2 gap-3">
              {fields.map((f) => {
                const val = values[courseId]?.[unit.id]?.[f.fieldKey] ?? "";
                // BOOL: カード内トグル
                if (f.inputType === "BOOL") {
                  return (
                    <label
                      key={f.fieldKey}
                      className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 p-4"
                    >
                      <input
                        type="checkbox"
                        checked={val === "true"}
                        onChange={(e) => setVal(courseId, unit.id, f.fieldKey, e.target.checked ? "true" : "false")}
                        className="h-5 w-5 accent-brand-700"
                      />
                      <span className="text-xs font-semibold text-slate-500">
                        {f.label}
                        {f.required && <span className="text-red-500 ml-0.5">*</span>}
                      </span>
                    </label>
                  );
                }
                // INT/TEXT/TIME: 旧フォーム同様のカード＋大きな数値入力
                const isInt = f.inputType === "INT";
                return (
                  <div key={f.fieldKey} className="bg-white rounded-xl border border-slate-200 p-4">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                      {f.label}
                      {f.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <input
                      type={isInt ? "number" : f.inputType === "TIME" ? "time" : "text"}
                      inputMode={isInt ? "numeric" : undefined}
                      min={isInt ? "0" : undefined}
                      placeholder={isInt ? "0" : ""}
                      value={val}
                      onChange={(e) => setVal(courseId, unit.id, f.fieldKey, e.target.value)}
                      className={
                        isInt
                          ? "w-full text-3xl font-bold text-brand-900 py-2 border-0 focus:outline-none bg-transparent"
                          : "w-full text-lg text-slate-900 py-2 border-0 focus:outline-none bg-transparent"
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 送信後画面: 今日の報酬見込み ＋ ランキング（チーム戦 or 個人）
// ============================================================
