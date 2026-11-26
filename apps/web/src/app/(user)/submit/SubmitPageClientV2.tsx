"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faTriangleExclamation,
  faCircleExclamation,
  faOilCan,
  faPhone,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { reportCycleTone, reportCycleTitle, orderCourseCycles } from "@/lib/reportCycles";
import { ReportFieldInputs } from "@/lib/components/ReportFieldInputs";
import { Skeleton } from "@/lib/components/Skeleton";
import { DatePicker } from "@/lib/components/DatePicker";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { VehiclePlate } from "@/lib/components/VehiclePlate";
import { PostSubmitView, ReportSubmitWaitView, type SubmitScreen } from "@/lib/components/PostSubmitView";
import { LoginSetupPrompt } from "@/lib/components/LoginSetupPrompt";
import { apiFetch } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { todayJST, reportDateDefaultJST, reportDateStrToDate, dateToReportDateStr } from "@/lib/date";
import { evaluateMeter } from "./submitFormUtils";
import { applyImageEntries } from "@repo/core/logic/reportImageEntries";
import { EMPTY_PARKING_CHOICE, ParkingLocationForm, type ParkingChoice } from "./ParkingReportField";
import ReportSourceImageField from "./ReportSourceImageField";
import type { DriverIdentity, SubmitVehicle as Vehicle, UnitDef, ShiftForm, ValueMap, ParkingPlaceOption, ParkingReport } from "@repo/core/types";
import { formatMonthDayJP } from "@repo/core/logic/calendar";
import { computeOilStatus, type OilLevel } from "@repo/core/logic/oilChange";
import {
  buildInitialValues,
  parseMeter,
  resolveDefaultVehicleId,
  resolveExistingMeter,
  findVehicle,
  buildReportItems,
  buildVehicleCards,
  groupFieldsByLabel,
  reportFormKey,
} from "@repo/core/logic/dailyReport";

// ============================================================
// 動的日報フォーム（新モデル）。
//   その日のシフト(=コース)ごとに、キャリア配下の unit と報告項目を動的描画。
//   複数シフト（昼ヤマト＋夜Amazon等）は複数カードで表示し、まとめて送信。
//   送信は POST /api/reports/v2（daily_reports_v2 + report_entries）。
//   ドメインロジックは @repo/core/logic/dailyReport に集約（純粋・テスト付き）。
// 注: 旧 SubmitPageClient とは別ファイル。ルートは page.tsx で切替。
// ============================================================

const PARKING_RESUME_KEY = "hakotora-pwa-parking-receipt";
const newReportKey = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
function rememberParkingReceipt(key: string | null) {
  try { if (key) sessionStorage.setItem(PARKING_RESUME_KEY, key); else sessionStorage.removeItem(PARKING_RESUME_KEY); }
  catch { /* sessionStorage unavailable: in-memory retry remains available */ }
}
type ParkingStep = { receiptKey: string; reportDate: string; vehicleId: string };
type ParkingResume = { stage: "not_found" } | { stage: "required" | "not_required" | "complete"; reportDate: string; vehicleId: string | null };

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

  // 成功画面をすぐ表示。報酬の取得は日報本体の保存と分け、再試行でも日報を再送しない。
  const [postSubmit, setPostSubmit] = useState<{
    date: string;
    state: { status: "loading" | "error" } | { status: "ready"; data: SubmitScreen };
  } | null>(null);
  const postSubmitRequest = useRef<AbortController | null>(null);
  useEffect(() => () => postSubmitRequest.current?.abort(), []);

  const loadPostSubmit = (date: string) => {
    postSubmitRequest.current?.abort();
    const request = new AbortController();
    postSubmitRequest.current = request;
    setPostSubmit({ date, state: { status: "loading" } });
    const timeout = window.setTimeout(() => {
      if (request.signal.aborted) return;
      request.abort();
      setPostSubmit({ date, state: { status: "error" } });
    }, 20_000);
    request.signal.addEventListener("abort", () => window.clearTimeout(timeout), { once: true });
    void apiFetch<SubmitScreen>(`/api/me/submit-screen?date=${encodeURIComponent(date)}`, {
      signal: request.signal, cache: "no-store",
    }, { skipAuthRedirect: true }).then((data) => {
      if (!request.signal.aborted) setPostSubmit({ date, state: { status: "ready", data } });
    }).catch(() => {
      if (!request.signal.aborted) setPostSubmit({ date, state: { status: "error" } });
    }).finally(() => window.clearTimeout(timeout));
  };

  const [shifts, setShifts] = useState<ShiftForm[]>([]);
  const [formRevision, setFormRevision] = useState("");
  const [requestedKeys, setRequestedKeys] = useState<string[]>([]);
  const [values, setValues] = useState<ValueMap>({});
  const [submitting, setSubmitting] = useState(false);
  const submitInFlight = useRef(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [parkingStep, setParkingStep] = useState<ParkingStep | null>(null);
  const [parkingDraft, setParkingDraft] = useState<ParkingChoice>(EMPTY_PARKING_CHOICE);
  const confirmedParking = useRef<{ choice: ParkingChoice; at: string } | null>(null);
  const [parkingResumeError, setParkingResumeError] = useState(false);
  const [resumingParking, setResumingParking] = useState(false);
  const reportKeyRef = useRef<string>(newReportKey());
  const { data: parkingPlacesData, error: parkingPlacesError, isInitialLoading: parkingPlacesLoading } = useApi<{ places: ParkingPlaceOption[] }>(
    parkingStep ? "/api/reports/parking-places" : null,
    { revalidateOnFocus: false },
  );

  function restoreParking() {
    let key: string | null = null;
    try { key = sessionStorage.getItem(PARKING_RESUME_KEY); } catch { /* storage unavailable */ }
    if (!key) return;
    const receiptKey = key;
    setResumingParking(true);
    setParkingResumeError(false);
    void apiFetch<ParkingResume>(`/api/reports/v2/parking?key=${encodeURIComponent(receiptKey)}`, { cache: "no-store" })
      .then(result => {
        if (result.stage === "required" && result.vehicleId) {
          setParkingStep({ receiptKey, reportDate: result.reportDate, vehicleId: result.vehicleId });
        } else if (result.stage === "complete" || result.stage === "not_required") {
          rememberParkingReceipt(null);
          loadPostSubmit(result.reportDate);
        } else {
          rememberParkingReceipt(null);
        }
      })
      .catch(() => setParkingResumeError(true))
      .finally(() => setResumingParking(false));
  }

  // 保存後にアプリがリロードされても、同じタブで駐車から再開。本人・日付・車両はサーバーから読む。
  useEffect(() => { restoreParking(); }, []);

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
    mutate: mutateForm,
  } = useApi<{ shifts: ShiftForm[]; candidates?: ShiftForm[]; revision: string; rejectedRequests?: { id: string; courseName: string; cycleNo: number }[]; shiftVehicleId?: string | null; vehicleReturnRequired?: boolean }>(
    `/api/me/report-form?date=${encodeURIComponent(reportFormDateStr)}&candidates=1&parkingPolicy=post_submit_map`,
    { revalidateOnFocus: false },
  );

  // 同一日付では再初期化しない（バックグラウンド再検証で入力を消さないため）。
  const initializedDateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!formData) return;
    if (initializedDateRef.current === reportFormDateStr) return;
    initializedDateRef.current = reportFormDateStr;
    setFormRevision(formData.revision);
    setRequestedKeys((formData.shifts ?? []).filter(s => s.requestId).map(s => reportFormKey(s.courseId, s.cycleNo)));
    const list = formData.shifts ?? [];
    setShifts(orderCourseCycles(list, s => s.courseId, s => s.cycleNo ?? 0));
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

  function setVal(formKey: string, unitId: string, fieldKey: string, v: string) {
    setValues((prev) => ({
      ...prev,
      [formKey]: { ...prev[formKey], [unitId]: { ...prev[formKey]?.[unitId], [fieldKey]: v } },
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

  // 走行距離の基準は車両に登録されている現在値（vehicles.current_mileage）のみ。
  // 日付ごとの「前回値」は使わない（2026-09-02 ユーザー指定）。
  const meterVehicle = selectedVehicle;

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
    if (submitInFlight.current) return;
    if (shifts.some(s => s.existing?.requiresReview)) {
      setMessage({ kind: "err", text: "提出済みの内容に便の設定と異なる項目があります。運営に確認してください。" });
      return;
    }
    // 走行距離の妥当性（未入力・登録値以下）を判定。表示と同一ロジックで送信もブロックする。
    const meterState = evaluateMeter(meter, meterVehicle);
    if (!meterState.canSubmit) {
      setMeterRequiredError(true);
      setMessage({
        kind: "err",
        text: meterState.missing
          ? "走行距離を入力してください"
          : `走行距離は現在の登録（${meterState.prevKm.toLocaleString("ja-JP")} km）より大きい値を入力してください`,
      });
      return;
    }

    submitInFlight.current = true;
    setSubmitting(true);
    setMessage(null);
    try {
      const items = buildReportItems(shifts, values, vehicleId, meterNum).map(item => ({ ...item,
        request: requestedKeys.includes(reportFormKey(item.courseId, item.cycleNo)),
      }));
      const receiptKey = reportKeyRef.current;
      rememberParkingReceipt(receiptKey);
      const result = await apiFetch<{ reportSaved?: boolean; parkingStage?: "required" | "not_required"; parkingVehicleId?: string | null }>("/api/reports/v2", {
        method: "POST",
        body: JSON.stringify({ reportDate: reportFormDateStr, driverIdentityId: selectedIdentityId, items,
          expectedRevision: formRevision, clientKey: receiptKey, parkingPolicy: "post_submit_map" }),
      });
      if (result.reportSaved !== true || !result.parkingStage) throw new Error("日報の保存を確認できませんでした。もう一度送信してください");
      reportKeyRef.current = newReportKey();
      setMessage({ kind: "ok", text: "日報を送信しました。" });
      if (result.parkingStage === "required") {
        if (!result.parkingVehicleId) throw new Error("駐車する車両を確認できませんでした");
        setParkingStep({ receiptKey, reportDate: reportFormDateStr, vehicleId: result.parkingVehicleId });
      } else {
        rememberParkingReceipt(null);
        loadPostSubmit(reportFormDateStr);
      }
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : "送信に失敗しました" });
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }

  async function saveParking(step: ParkingStep, draft: ParkingChoice) {
    if (submitInFlight.current) return;
    const date = step.reportDate === todayJST() ? null : new Date(step.reportDate + "T00:00:00Z");
    if (date && draft.nextDay) date.setUTCDate(date.getUTCDate() + 1);
    const at = !date && confirmedParking.current?.choice === draft
      ? confirmedParking.current.at
      : date ? date.toISOString().slice(0, 10) + "T" + draft.time + ":00+09:00" : new Date().toISOString();
    confirmedParking.current = { choice: draft, at };
    setParkingDraft(draft);
    setMessage(null);
    submitInFlight.current = true;
    setSubmitting(true);
    try {
      const parking: Omit<ParkingReport, "clientKey"> = { vehicleId: step.vehicleId, status: "parked",
        placeId: draft.placeId, slotId: draft.slotId, coords: draft.pin, at, note: draft.note.trim() || null };
      const result = await apiFetch<{ parkingSaved?: boolean }>("/api/reports/v2/parking", {
        method: "POST", body: JSON.stringify({ receiptKey: step.receiptKey, parking }),
      });
      if (result.parkingSaved !== true) throw new Error("駐車場所の記録を確認できませんでした");
      rememberParkingReceipt(null);
      setParkingStep(null);
      setParkingDraft(EMPTY_PARKING_CHOICE);
      confirmedParking.current = null;
      loadPostSubmit(step.reportDate);
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : "駐車場所を記録できませんでした。もう一度お試しください" });
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }

  if (resumingParking || submitting || postSubmit?.state.status === "loading") {
    return <ReportSubmitWaitView phase={postSubmit?.state.status === "loading" ? "reward" : "submit"} />;
  }

  if (parkingResumeError) return <div className="mx-auto max-w-md space-y-4 p-4">
    <h1 className="text-lg font-semibold">駐車場所の記録を確認できませんでした</h1>
    <button type="button" className="min-h-12 w-full rounded-lg bg-slate-900 text-white" onClick={restoreParking}>もう一度確認</button>
  </div>;

  if (postSubmit) {
    return (
      <PostSubmitView
        confirmed
        data={postSubmit.state.status === "ready" ? postSubmit.state.data : null}
        onRetry={() => loadPostSubmit(postSubmit.date)}
        onClose={() => {
          postSubmitRequest.current?.abort();
          postSubmitRequest.current = null;
          setPostSubmit(null);
          initializedDateRef.current = null;
          void mutateForm();
        }}
      />
    );
  }

  if (parkingStep) {
    return <section className="parking-page flex min-h-0 flex-1 flex-col bg-white" aria-labelledby="parking-title">
      <h1 id="parking-title" className="flex min-h-12 shrink-0 items-center border-b border-slate-200 px-4 text-lg font-semibold text-slate-900">駐車場所</h1>
      <ParkingLocationForm key={parkingStep.receiptKey} places={parkingPlacesData?.places} loading={parkingPlacesLoading} lookupError={!!parkingPlacesError}
        locatingAllowed={parkingStep.reportDate === todayJST()} value={parkingDraft}
        error={message?.kind === "err" ? message.text : null} onConfirm={choice => saveParking(parkingStep, choice)} />
    </section>;
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

      <LoginSetupPrompt />

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
          const sel = meterVehicle;
          if (!sel || sel.is_ev) return null;
          const meterState = evaluateMeter(meter, sel);
          const prevKm = meterState.prevKm;
          const placeholder = prevKm > 0 ? `現在: ${prevKm.toLocaleString("ja-JP")} km` : "例: 14567";
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
                  現在の登録（{prevKm.toLocaleString("ja-JP")} km）より大きい値を入力してください
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
          {shifts.map((s) => {
            const formKey = reportFormKey(s.courseId, s.cycleNo);
            const isRequested = requestedKeys.includes(formKey);
            const courseLabel = [s.courseName, s.cycleLabel || (s.cycleNo ? `C${s.cycleNo}` : "")].filter(Boolean).join(" ");
            return (
            <div key={formKey} className={`rounded-lg border ${reportCycleTone(s.cycleNo ?? 0).border} ${reportCycleTone(s.cycleNo ?? 0).surface}`}>
              <div className={`relative flex flex-wrap items-center gap-2 px-4 py-2.5 border-b ${isRequested ? "min-h-11 pr-14" : ""} ${reportCycleTone(s.cycleNo ?? 0).border}`}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color ?? "#94a3b8" }} />
                <span className={(s.cycleNo ?? 0) > 0 ? "text-xs text-slate-600" : "font-medium text-slate-800"}>{s.courseName}</span>
                {(s.cycleNo ?? 0) > 0 && (
                  <span className="order-first font-semibold text-slate-900">
                    {reportCycleTitle(s.cycleNo ?? 0, s.cycleLabel, s.units.flatMap(u => u.fields.map(f => f.groupLabel)))}
                  </span>
                )}
                {s.carrierName && <span className="text-[11px] text-slate-400">{s.carrierName}</span>}
                {isRequested && <button type="button" aria-label={`${courseLabel}の追加を取り消す`} disabled={submitting} onClick={async () => {
                  setMessage(null);
                  if (s.requestId) {
                    setSubmitting(true);
                    try {
                      const result = await apiFetch<{ revision: string }>(`/api/reports/course-requests?id=${encodeURIComponent(s.requestId)}`, { method: "DELETE" });
                      setFormRevision(result.revision);
                    } catch (e) { setMessage({ kind: "err", text: e instanceof Error ? e.message : "申請を取り消せませんでした" }); return; }
                    finally { setSubmitting(false); }
                  }
                  setShifts(current => s.requestAssigned ? current.map(item => item === s ? { ...item, requestId: undefined, requestAssigned: undefined } : item) : current.filter(item => reportFormKey(item.courseId, item.cycleNo) !== formKey));
                  setRequestedKeys(current => current.filter(key => key !== formKey));
                }} className="absolute right-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-slate-600 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-slate-700 disabled:opacity-50">
                  <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
                </button>}
              </div>
              <div className="px-4 py-3 space-y-4">
                {s.units.length === 0 && <p className="text-xs text-slate-400">報告項目が設定されていません。</p>}
                {s.units.map((u) => (
                  <UnitFields hideSingleGroup={(s.cycleNo ?? 0) > 0 && new Set(s.units.flatMap(unit => unit.fields.map(field => field.groupLabel?.trim()).filter(Boolean))).size === 1} key={u.id} unit={u} formKey={formKey} values={values} setVal={setVal} />
                ))}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {!formLoading && !formError && (() => {
        const activeKeys = new Set(shifts.map(shift => reportFormKey(shift.courseId, shift.cycleNo)));
        const choices = (formData?.candidates ?? []).filter(candidate => !activeKeys.has(reportFormKey(candidate.courseId, candidate.cycleNo)));
        if (!choices.length) return null;
        return <CustomSelect
          ariaLabel="コースを追加"
          size="md"
          placeholder="＋ コースを追加"
          clearable={false}
          disabled={submitting}
          triggerClassName="!border [&_div.text-slate-400]:text-slate-600"
          options={choices.map(candidate => ({ value: reportFormKey(candidate.courseId, candidate.cycleNo), label: `${candidate.courseName}${candidate.cycleLabel ? ` ${candidate.cycleLabel}` : ""}` }))}
          onChange={key => {
            const candidate = choices.find(item => reportFormKey(item.courseId, item.cycleNo) === key);
            if (!candidate) return;
            setShifts(current => current.some(item => reportFormKey(item.courseId, item.cycleNo) === key) ? current : orderCourseCycles([...current, candidate], item => item.courseId, item => item.cycleNo ?? 0));
            setRequestedKeys(current => current.includes(key) ? current : [...current, key]);
          }}
        />;
      })()}

      {(formData?.rejectedRequests?.length ?? 0) > 0 && <p className="text-sm text-amber-800">追加申請が却下されました。必要なコースを選び直して送信してください。</p>}

      {/* 配完表などの原本画像。読み取れた件数は本人の確認後にフォームへ入る（RIMG-2 / RIMG-3） */}
      {shifts.length > 0 && (
        <ReportSourceImageField
          reportDate={reportFormDateStr}
          courseId={new Set(shifts.map(s => s.courseId)).size === 1 ? shifts[0]?.courseId : null}
          shifts={shifts} values={values}
          onApply={(entries) => {
            setValues((prev) => applyImageEntries(prev, shifts, entries).values);
          }}
        />
      )}

      {shifts.some(s => s.existing?.requiresReview) && <p role="alert" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">提出済みの内容に便の設定と異なる項目があります。運営に確認してください。</p>}
      {message && (
        <div className={`text-sm rounded px-3 py-2 ${message.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{message.text}</div>
      )}

      <button
        type="button"
        disabled={submitting || shifts.length === 0 || shifts.some(s => s.existing?.requiresReview)}
        onClick={submit}
        className="w-full py-3 rounded-lg bg-slate-900 text-white font-medium disabled:opacity-50"
      >
        {vehicleId && formData?.vehicleReturnRequired ? "返却場所を選択" : "送信"}
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
  hideSingleGroup = false,
  unit,
  formKey,
  values,
  setVal,
}: {
  hideSingleGroup?: boolean;
  unit: UnitDef;
  formKey: string;
  values: ValueMap;
  setVal: (formKey: string, unitId: string, fieldKey: string, v: string) => void;
}) {
  // group_label でグルーピング（null はグループなし）
  const groups = groupFieldsByLabel(unit.fields);

  return (
    <div>
      <div className="text-sm font-medium text-slate-700 mb-1.5">{unit.name}</div>
      <div className="space-y-2">
        {groups.map(([groupKey, fields]) => (
          <div key={groupKey}>
            {groupKey && !(hideSingleGroup && groups.length === 1) && <div className="text-[11px] text-indigo-600 mb-1">{groupKey}</div>}
            <ReportFieldInputs fields={fields} valueFor={key => values[formKey]?.[unit.id]?.[key] ?? ""}
              onChange={(key, value) => setVal(formKey, unit.id, key, value)} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 送信後画面: 今日の報酬見込み ＋ ランキング（チーム戦 or 個人）
// ============================================================
