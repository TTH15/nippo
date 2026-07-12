import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator, ScrollView } from "react-native";
import {
  fetchToday,
  resolveQr,
  checkIn,
  checkOut,
  uploadMeterPhoto,
  uploadInspectionPhoto,
  plateText,
  type WorkSession,
  type ResolvedVehicle,
  type InspectionAngle,
} from "../api/work";
import { getGps } from "../location";
import { PunchButton } from "../components/PunchButton";
import { BottomSheet } from "../components/BottomSheet";
import { MeterScanner } from "../components/MeterScanner";
import { LicenseSpotCheck } from "../components/LicenseSpotCheck";
import { VehicleInspectionCapture, type InspectionShot } from "../components/VehicleInspectionCapture";
import { QrFallback, type FallbackResolution } from "../components/QrFallback";
import { apiFetch } from "@repo/core/api";
import type { DriverIdentity, SubmitVehicle, ShiftForm, ValueMap, VehiclePlateData } from "@repo/core/types";
import { toLocalDateStr, formatMonthDayJP, reportDateDefaultJST } from "@repo/core/logic/calendar";
import {
  buildInitialValues,
  parseMeter as parseReportMeter,
  resolveDefaultVehicleId,
  resolveExistingMeter,
  buildReportItems,
  buildVehicleCards,
  groupFieldsByLabel,
} from "@repo/core/logic/dailyReport";

// 業務タブ = 出退勤（qr_flow v2.0）＋ 日報入力。同じ業務フローの一部なのでタブを分けない。

const INPUT = "border border-brand-200 rounded-lg px-3 py-2.5 text-base bg-white text-brand-900";
const CHIP = "py-2 px-3.5 rounded-full border";

function parseMeter(s: string): number | null {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "通信に失敗しました";
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

const addDays = (dateStr: string, delta: number): string => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return toLocalDateStr(d);
};

const reportPlateText = (v: VehiclePlateData): string =>
  [v.number_class, v.number_hiragana, v.number_numeric].filter(Boolean).join(" ") || v.id;

// 安全確認（qr_flow v2.0 Phase2）。出勤時のみ・QR認証後～車両記録の前に挟む。
// 一定確率で通常のチェックボックス確認から抜き打ちの免許証撮影確認に切り替える。
const SPOT_CHECK_RATE = 0.15;

export function WorkScreen() {
  // --- 出退勤（Phase1: QR認証 → Bottom Sheet） ---
  const [workLoading, setWorkLoading] = useState(true);
  const [open, setOpen] = useState<WorkSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [workMsg, setWorkMsg] = useState<string | null>(null);

  const [inVehicle, setInVehicle] = useState<ResolvedVehicle | null>(null);
  const [inToken, setInToken] = useState<string | null>(null);
  const [inMeter, setInMeter] = useState("");

  // 安全確認（Phase2、出勤時のみ）: QR認証直後に自動判定・表示。通過後に車両記録(メーター)へ進む。
  const [safetyMode, setSafetyMode] = useState<"checkbox" | "photo" | null>(null);
  const [safetyPassed, setSafetyPassed] = useState(false);
  const [licenseChecked, setLicenseChecked] = useState(false);
  const [licenseCameraOpen, setLicenseCameraOpen] = useState(false);

  // QR退避ルート（vehicle-session-flow.md §8.5）: 「QRが読めない」→ ナンバープレートOCR/手動申請。
  const [fallbackOpenFor, setFallbackOpenFor] = useState<"in" | "out" | null>(null);
  const [inMethod, setInMethod] = useState<"qr" | "plate_ocr" | "manual">("qr");
  const [inFallbackVehicle, setInFallbackVehicle] = useState<VehiclePlateData | null>(null);
  const [inPlatePhotoPath, setInPlatePhotoPath] = useState<string | undefined>(undefined);
  const [inFallbackReason, setInFallbackReason] = useState<string | undefined>(undefined);

  const [outToken, setOutToken] = useState<string | null>(null);
  const [outMeter, setOutMeter] = useState("");
  const [outMethod, setOutMethod] = useState<"qr" | "plate_ocr" | "manual">("qr");
  const [outFallbackVehicle, setOutFallbackVehicle] = useState<VehiclePlateData | null>(null);
  const [outPlatePhotoPath, setOutPlatePhotoPath] = useState<string | undefined>(undefined);
  const [outFallbackReason, setOutFallbackReason] = useState<string | undefined>(undefined);

  const [meterScanFor, setMeterScanFor] = useState<"in" | "out" | null>(null);
  const [meterBase64, setMeterBase64] = useState<string | null>(null);

  // 車両点検（Phase3・前後左右4方向）。in/outどちらの車両記録でも撮影可能（pre/postの比較用）。
  const [inspectionOpenFor, setInspectionOpenFor] = useState<"in" | "out" | null>(null);
  const [inInspectionPaths, setInInspectionPaths] = useState<Array<{ angle: InspectionAngle; path: string }>>([]);
  const [outInspectionPaths, setOutInspectionPaths] = useState<Array<{ angle: InspectionAngle; path: string }>>([]);
  const [inspectionUploading, setInspectionUploading] = useState(false);

  function onMeterConfirmed(value: number | null, base64: string) {
    if (value != null) {
      if (meterScanFor === "in") setInMeter(String(value));
      else if (meterScanFor === "out") setOutMeter(String(value));
    }
    setMeterBase64(base64);
    setMeterScanFor(null);
  }

  async function onInspectionComplete(shots: InspectionShot[]) {
    const target = inspectionOpenFor;
    setInspectionOpenFor(null);
    if (!target) return;
    setInspectionUploading(true);
    const paths: Array<{ angle: InspectionAngle; path: string }> = [];
    for (const shot of shots) {
      try {
        const { path } = await uploadInspectionPhoto(shot.base64);
        paths.push({ angle: shot.angle, path });
      } catch {
        // 写真アップロード失敗は無視（この角度だけ欠けても業務は続行できる）
      }
    }
    setInspectionUploading(false);
    if (target === "in") setInInspectionPaths(paths);
    else setOutInspectionPaths(paths);
  }

  const reload = useCallback(async () => {
    setWorkLoading(true);
    try {
      const t = await fetchToday();
      setOpen(t.open);
    } catch (e) {
      setWorkMsg(errMsg(e));
    } finally {
      setWorkLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onScanIn(data: string): Promise<boolean> {
    setBusy(true);
    setWorkMsg(null);
    try {
      const r = await resolveQr(data);
      if (!r.ok || !r.vehicle) {
        setWorkMsg(r.message ?? "読み取れませんでした。");
        return false;
      }
      setInVehicle(r.vehicle);
      setInToken(data);
      setInMethod("qr");
      setInFallbackVehicle(null);
      setInPlatePhotoPath(undefined);
      setInFallbackReason(undefined);
      setSafetyMode(Math.random() < SPOT_CHECK_RATE ? "photo" : "checkbox");
      setSafetyPassed(false);
      setLicenseChecked(false);
      return true;
    } catch (e) {
      setWorkMsg(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onInFallbackResolved(result: FallbackResolution) {
    setFallbackOpenFor(null);
    const v = result.vehicle;
    setInVehicle({
      id: v.id,
      numberPrefix: v.number_prefix ?? null,
      numberClass: v.number_class ?? null,
      numberHiragana: v.number_hiragana ?? null,
      numberNumeric: v.number_numeric ?? null,
    });
    setInToken(null);
    setInMethod(result.method);
    setInFallbackVehicle(v);
    setInPlatePhotoPath(result.method === "plate_ocr" ? result.platePhotoPath : undefined);
    setInFallbackReason(result.method === "manual" ? result.fallbackReason : undefined);
    setSafetyMode(Math.random() < SPOT_CHECK_RATE ? "photo" : "checkbox");
    setSafetyPassed(false);
    setLicenseChecked(false);
  }

  async function confirmIn() {
    if (!inToken && !inFallbackVehicle) return;
    setBusy(true);
    setWorkMsg(null);
    try {
      const gps = await getGps();
      let odometerPhotoPath: string | undefined;
      if (meterBase64) {
        try {
          odometerPhotoPath = (await uploadMeterPhoto(meterBase64)).path;
        } catch {
          /* 写真アップロード失敗は無視 */
        }
      }
      const res = await checkIn({
        ...(inToken
          ? { token: inToken }
          : { method: inMethod, vehicleId: inFallbackVehicle!.id, platePhotoPath: inPlatePhotoPath, fallbackReason: inFallbackReason }),
        odometer: parseMeter(inMeter),
        lat: gps.lat,
        lng: gps.lng,
        gpsStatus: gps.status,
        odometerPhotoPath,
        inspectionPhotos: inInspectionPaths,
      });
      if (!res.ok) {
        setWorkMsg(res.message ?? "出勤に失敗しました。");
        return;
      }
      setInVehicle(null);
      setInToken(null);
      setInMeter("");
      setMeterBase64(null);
      setSafetyMode(null);
      setSafetyPassed(false);
      setLicenseChecked(false);
      setInInspectionPaths([]);
      setInMethod("qr");
      setInFallbackVehicle(null);
      setInPlatePhotoPath(undefined);
      setInFallbackReason(undefined);
      await reload();
    } catch (e) {
      setWorkMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function cancelIn() {
    setInVehicle(null);
    setInToken(null);
    setInMeter("");
    setMeterBase64(null);
    setSafetyMode(null);
    setSafetyPassed(false);
    setLicenseChecked(false);
    setLicenseCameraOpen(false);
    setInInspectionPaths([]);
    setInMethod("qr");
    setInFallbackVehicle(null);
    setInPlatePhotoPath(undefined);
    setInFallbackReason(undefined);
    setWorkMsg(null);
  }

  async function onScanOut(data: string): Promise<boolean> {
    if (!open) return false;
    setOutToken(data);
    setOutMethod("qr");
    setOutFallbackVehicle(null);
    setOutPlatePhotoPath(undefined);
    setOutFallbackReason(undefined);
    return true;
  }

  function onOutFallbackResolved(result: FallbackResolution) {
    setFallbackOpenFor(null);
    setOutToken(null);
    setOutMethod(result.method);
    setOutFallbackVehicle(result.vehicle);
    setOutPlatePhotoPath(result.method === "plate_ocr" ? result.platePhotoPath : undefined);
    setOutFallbackReason(result.method === "manual" ? result.fallbackReason : undefined);
  }

  async function confirmOut() {
    if (!open || (!outToken && !outFallbackVehicle)) return;
    setBusy(true);
    setWorkMsg(null);
    try {
      const gps = await getGps();
      let odometerPhotoPath: string | undefined;
      if (meterBase64) {
        try {
          odometerPhotoPath = (await uploadMeterPhoto(meterBase64)).path;
        } catch {
          /* 写真アップロード失敗は無視 */
        }
      }
      const res = await checkOut({
        sessionId: open.id,
        ...(outToken
          ? { token: outToken }
          : { method: outMethod, vehicleId: outFallbackVehicle!.id, platePhotoPath: outPlatePhotoPath, fallbackReason: outFallbackReason }),
        odometer: parseMeter(outMeter),
        lat: gps.lat,
        lng: gps.lng,
        gpsStatus: gps.status,
        odometerPhotoPath,
        inspectionPhotos: outInspectionPaths,
      });
      if (!res.ok) {
        setWorkMsg(res.message ?? "業務終了に失敗しました。");
        return;
      }
      setOutToken(null);
      setOutMeter("");
      setMeterBase64(null);
      setOutInspectionPaths([]);
      setOutMethod("qr");
      setOutFallbackVehicle(null);
      setOutPlatePhotoPath(undefined);
      setOutFallbackReason(undefined);
      await reload();
    } catch (e) {
      setWorkMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function cancelOut() {
    setOutToken(null);
    setOutMeter("");
    setMeterBase64(null);
    setOutInspectionPaths([]);
    setOutMethod("qr");
    setOutFallbackVehicle(null);
    setOutPlatePhotoPath(undefined);
    setOutFallbackReason(undefined);
    setWorkMsg(null);
  }

  // --- 日報入力（submit-v2。値構築・整形はWebと同じ @repo/core/logic/dailyReport） ---
  const [reportDate, setReportDate] = useState(() => reportDateDefaultJST());
  const [identities, setIdentities] = useState<DriverIdentity[]>([]);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [reportVehicles, setReportVehicles] = useState<SubmitVehicle[]>([]);
  const [unlinked, setUnlinked] = useState<SubmitVehicle[]>([]);
  const [shifts, setShifts] = useState<ShiftForm[]>([]);
  const [shiftVehicleId, setShiftVehicleId] = useState<string | null>(null);
  const [reportVehicleId, setReportVehicleId] = useState<string | null>(null);
  const [reportMeter, setReportMeter] = useState("");
  const [values, setValues] = useState<ValueMap>({});
  const [reportInitLoading, setReportInitLoading] = useState(true);
  const [reportFormLoading, setReportFormLoading] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [reportError, setReportError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [prof, veh, unl] = await Promise.all([
          apiFetch<{ identities?: DriverIdentity[] }>("/api/reports/profile"),
          apiFetch<{ vehicles: SubmitVehicle[] }>("/api/reports/vehicles"),
          apiFetch<{ vehicles: SubmitVehicle[] }>("/api/reports/vehicles-unlinked").catch(() => ({ vehicles: [] })),
        ]);
        if (!alive) return;
        const ids = prof.identities ?? [];
        setIdentities(ids);
        setIdentityId(ids[0]?.id ?? null);
        setReportVehicles(veh.vehicles ?? []);
        setUnlinked(unl.vehicles ?? []);
      } catch (e) {
        if (alive) setReportError(e instanceof Error ? e.message : "初期データの取得に失敗しました");
      } finally {
        if (alive) setReportInitLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setReportFormLoading(true);
    setReportMessage("");
    apiFetch<{ shifts: ShiftForm[]; shiftVehicleId?: string | null }>(`/api/me/report-form?date=${reportDate}`)
      .then((d) => {
        if (!alive) return;
        const sh = d.shifts ?? [];
        setShifts(sh);
        setShiftVehicleId(d.shiftVehicleId ?? null);
        setValues(buildInitialValues(sh));
        setReportVehicleId(resolveDefaultVehicleId(sh, d.shiftVehicleId ?? null));
        setReportMeter(resolveExistingMeter(sh));
      })
      .catch((e) => {
        if (alive) setReportError(e instanceof Error ? e.message : "フォームの取得に失敗しました");
      })
      .finally(() => {
        if (alive) setReportFormLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reportDate]);

  const setVal = (courseId: string, unitId: string, fieldKey: string, v: string) =>
    setValues((prev) => ({
      ...prev,
      [courseId]: {
        ...prev[courseId],
        [unitId]: { ...prev[courseId]?.[unitId], [fieldKey]: v },
      },
    }));

  const submitReport = async () => {
    if (!identityId) {
      setReportError("勤務区分が選択されていません");
      return;
    }
    setReportSubmitting(true);
    setReportError("");
    setReportMessage("");
    try {
      const items = buildReportItems(shifts, values, reportVehicleId, parseReportMeter(reportMeter));
      await apiFetch("/api/reports/v2", {
        method: "POST",
        body: JSON.stringify({ reportDate, driverIdentityId: identityId, items }),
      });
      setReportMessage("日報を送信しました");
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setReportSubmitting(false);
    }
  };

  const { cards } = buildVehicleCards({
    vehicles: reportVehicles,
    unlinked,
    vehicleId: reportVehicleId,
    shiftVehicleId,
    showOtherVehicles: false,
  });

  // QR退避ルートの候補車両。退勤は稼働中セッションの車両1台に絞る（それ以外は結局サーバに拒否されるため）。
  const outFallbackCandidates = (() => {
    if (!open) return reportVehicles;
    const match = reportVehicles.find((v) => v.id === open.vehicle_id);
    return match ? [match] : reportVehicles;
  })();

  if (workLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white" contentContainerClassName="pt-16 pb-10 gap-8">
      {/* 出退勤 */}
      <View className="px-4 items-center gap-6">
        <Text className="text-[26px] font-bold text-brand-900 self-start">業務</Text>

        {workMsg && (
          <View className="w-full bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <Text className="text-amber-800 text-[13px]">{workMsg}</Text>
          </View>
        )}

        {open && (
          <View className="w-full bg-white rounded-xl p-4 gap-1 border border-brand-200">
            <View className="flex-row items-center gap-2">
              <View className="w-2 h-2 rounded-full bg-accent-500" />
              <Text className="text-accent-600 font-semibold">稼働中</Text>
            </View>
            <Text className="text-brand-500 text-[13px] mt-2">出勤時刻</Text>
            <Text className="text-brand-900 text-base font-semibold">{formatTime(open.started_at)}</Text>
            {open.start_odometer != null && (
              <>
                <Text className="text-brand-500 text-[13px] mt-2">開始メーター</Text>
                <Text className="text-brand-900 text-base font-semibold">{open.start_odometer} km</Text>
              </>
            )}
          </View>
        )}

        <PunchButton
          mode={open ? "end" : "start"}
          busy={busy}
          onScanned={open ? onScanOut : onScanIn}
          onFallback={() => setFallbackOpenFor(open ? "out" : "in")}
        />
      </View>

      <View className="h-2 bg-brand-50" />

      {/* 日報入力 */}
      <View className="px-4 gap-2.5">
        <Text className="text-xl font-bold text-brand-900">日報入力</Text>

        <View className="flex-row items-center justify-center gap-5">
          <Pressable className="px-3.5 py-1 rounded-lg bg-brand-100 active:opacity-80" onPress={() => setReportDate((d) => addDays(d, -1))}>
            <Text className="text-xl text-brand-700 leading-6">‹</Text>
          </Pressable>
          <Text className="text-base font-semibold text-brand-900 min-w-[110px] text-center">{formatMonthDayJP(reportDate)}</Text>
          <Pressable className="px-3.5 py-1 rounded-lg bg-brand-100 active:opacity-80" onPress={() => setReportDate((d) => addDays(d, 1))}>
            <Text className="text-xl text-brand-700 leading-6">›</Text>
          </Pressable>
        </View>

        {reportInitLoading ? (
          <View className="py-6 items-center">
            <ActivityIndicator />
          </View>
        ) : (
          <>
            {identities.length > 1 && (
              <View className="flex-row flex-wrap gap-2">
                {identities.map((i) => {
                  const on = identityId === i.id;
                  return (
                    <Pressable
                      key={i.id}
                      className={`${CHIP} ${on ? "bg-brand-900 border-brand-900" : "bg-white border-brand-200"}`}
                      onPress={() => setIdentityId(i.id)}
                    >
                      <Text className={`text-[13px] ${on ? "text-white" : "text-brand-700"}`}>{i.label || i.driverCode}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Text className="text-[13px] text-brand-500 mt-2">車両</Text>
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                className={`${CHIP} ${reportVehicleId === null ? "bg-brand-900 border-brand-900" : "bg-white border-brand-200"}`}
                onPress={() => setReportVehicleId(null)}
              >
                <Text className={`text-[13px] ${reportVehicleId === null ? "text-white" : "text-brand-700"}`}>車両なし</Text>
              </Pressable>
              {cards.map((v) => {
                const on = reportVehicleId === v.id;
                return (
                  <Pressable
                    key={v.id}
                    className={`${CHIP} ${on ? "bg-brand-900 border-brand-900" : "bg-white border-brand-200"}`}
                    onPress={() => setReportVehicleId(v.id)}
                  >
                    <Text className={`text-[13px] ${on ? "text-white" : "text-brand-700"}`}>{reportPlateText(v)}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text className="text-[13px] text-brand-500 mt-2">メーター（km）</Text>
            <TextInput
              className={INPUT}
              value={reportMeter}
              onChangeText={(t) => setReportMeter(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              placeholder="例: 123456"
            />

            {reportFormLoading ? (
              <View className="py-6 items-center">
                <ActivityIndicator />
              </View>
            ) : shifts.length === 0 ? (
              <Text className="text-brand-300 py-4 text-center">この日のシフトはありません</Text>
            ) : (
              shifts.map((s) => (
                <View key={s.courseId} className="bg-white rounded-[10px] border border-brand-200 p-3 gap-2.5 mt-1.5">
                  <Text className="text-base font-bold text-brand-900">{s.courseName}</Text>
                  {s.units.map((u) => (
                    <View key={u.id} className="gap-1.5">
                      <Text className="text-sm font-semibold text-brand-700">{u.name}</Text>
                      {groupFieldsByLabel(u.fields).map(([group, fields]) => (
                        <View key={group || "_"} className="gap-1.5 pl-1">
                          {group ? <Text className="text-xs text-brand-500 mt-1">{group}</Text> : null}
                          {fields.map((f) => {
                            const raw = values[s.courseId]?.[u.id]?.[f.fieldKey] ?? "";
                            if (f.inputType === "BOOL") {
                              const on = raw === "true";
                              return (
                                <Pressable
                                  key={f.fieldKey}
                                  className="flex-row items-center justify-between py-1.5"
                                  onPress={() => setVal(s.courseId, u.id, f.fieldKey, on ? "false" : "true")}
                                >
                                  <Text className="text-[13px] text-brand-700">{f.label}</Text>
                                  <View
                                    className={`w-6 h-6 rounded-md border items-center justify-center ${on ? "bg-brand-900 border-brand-900" : "bg-white border-brand-200"}`}
                                  >
                                    {on ? <Text className="text-white font-bold">✓</Text> : null}
                                  </View>
                                </Pressable>
                              );
                            }
                            return (
                              <View key={f.fieldKey} className="gap-1">
                                <Text className="text-[13px] text-brand-700">{f.label}</Text>
                                <TextInput
                                  className={INPUT}
                                  value={raw}
                                  onChangeText={(t) =>
                                    setVal(s.courseId, u.id, f.fieldKey, f.inputType === "INT" ? t.replace(/[^0-9]/g, "") : t)
                                  }
                                  keyboardType={f.inputType === "INT" ? "number-pad" : "default"}
                                  placeholder={f.inputType === "TIME" ? "HH:MM" : ""}
                                />
                              </View>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              ))
            )}

            {reportError ? <Text className="text-red-600 py-1">{reportError}</Text> : null}
            {reportMessage ? <Text className="text-accent-600 py-1 font-semibold">{reportMessage}</Text> : null}

            <Pressable
              className={`mt-2 bg-accent-500 py-3.5 rounded-lg items-center active:opacity-80 ${shifts.length === 0 || reportSubmitting ? "opacity-40" : ""}`}
              onPress={submitReport}
              disabled={shifts.length === 0 || reportSubmitting}
            >
              <Text className="text-white font-bold text-base">{reportSubmitting ? "送信中..." : "日報を送信"}</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* 出勤: QR認証後の安全確認（Phase2） */}
      <BottomSheet visible={inVehicle !== null && !safetyPassed}>
        <Text className="text-[13px] text-brand-500">安全確認</Text>
        {safetyMode === "photo" ? (
          <>
            <Text className="text-xl font-bold text-brand-900">免許証を撮影して確認します</Text>
            <Pressable
              className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
              onPress={() => setLicenseCameraOpen(true)}
            >
              <Text className="text-brand-700 font-medium">免許証を撮影する</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            className="flex-row items-center gap-2.5 py-1"
            onPress={() => setLicenseChecked((v) => !v)}
          >
            <View
              className={`w-6 h-6 rounded-md border items-center justify-center ${licenseChecked ? "bg-brand-900 border-brand-900" : "bg-white border-brand-200"}`}
            >
              {licenseChecked ? <Text className="text-white font-bold">✓</Text> : null}
            </View>
            <Text className="text-base text-brand-900">免許証を携帯しています</Text>
          </Pressable>
        )}
        <View className="flex-row gap-2 mt-1">
          {safetyMode === "checkbox" && (
            <Pressable
              className={`flex-1 bg-accent-500 rounded-lg py-3 items-center active:opacity-80 ${!licenseChecked ? "opacity-40" : ""}`}
              onPress={() => setSafetyPassed(true)}
              disabled={!licenseChecked}
            >
              <Text className="text-white font-semibold">次へ</Text>
            </Pressable>
          )}
          <Pressable className="px-4 bg-brand-100 rounded-lg py-3 items-center active:opacity-80" onPress={cancelIn}>
            <Text className="text-brand-600">やめる</Text>
          </Pressable>
        </View>
      </BottomSheet>

      {/* 出勤: 安全確認後の車両確認・メーター入力 */}
      <BottomSheet visible={inVehicle !== null && safetyPassed}>
        <Text className="text-[13px] text-brand-500">この車両で出勤します</Text>
        <Text className="text-xl font-bold text-brand-900">{plateText(inVehicle) || "車両"}</Text>
        <Text className="text-[13px] text-brand-500 mt-1">開始メーター（km）</Text>
        <TextInput
          className={INPUT}
          value={inMeter}
          onChangeText={(t) => setInMeter(t.replace(/[^0-9]/g, ""))}
          keyboardType="number-pad"
          placeholder="例: 123456"
        />
        <Pressable
          className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
          onPress={() => setMeterScanFor("in")}
          disabled={busy}
        >
          <Text className="text-brand-700 font-medium">メーターをカメラで読み取り</Text>
        </Pressable>
        {meterBase64 ? <Text className="text-xs text-accent-600">写真を添付しました</Text> : null}
        <Pressable
          className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
          onPress={() => setInspectionOpenFor("in")}
          disabled={busy || inspectionUploading}
        >
          <Text className="text-brand-700 font-medium">車両点検（前後左右を撮影）</Text>
        </Pressable>
        {inspectionUploading ? (
          <Text className="text-xs text-brand-400">点検写真をアップロード中...</Text>
        ) : inInspectionPaths.length > 0 ? (
          <Text className="text-xs text-accent-600">点検写真を{inInspectionPaths.length}枚添付しました</Text>
        ) : null}
        <View className="flex-row gap-2 mt-1">
          <Pressable
            className="flex-1 bg-accent-500 rounded-lg py-3 items-center active:opacity-80"
            onPress={confirmIn}
            disabled={busy}
          >
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-white font-semibold">出勤する</Text>}
          </Pressable>
          <Pressable
            className="px-4 bg-brand-100 rounded-lg py-3 items-center active:opacity-80"
            onPress={cancelIn}
            disabled={busy}
          >
            <Text className="text-brand-600">やめる</Text>
          </Pressable>
        </View>
      </BottomSheet>

      {/* 退勤: QR認証後のメーター入力 */}
      <BottomSheet visible={outToken !== null || outFallbackVehicle !== null}>
        <Text className="text-[13px] text-brand-500">終了メーターを入力して業務終了します。</Text>
        <Text className="text-[13px] text-brand-500 mt-1">終了メーター（km）</Text>
        <TextInput
          className={INPUT}
          value={outMeter}
          onChangeText={(t) => setOutMeter(t.replace(/[^0-9]/g, ""))}
          keyboardType="number-pad"
          placeholder="例: 123480"
        />
        <Pressable
          className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
          onPress={() => setMeterScanFor("out")}
          disabled={busy}
        >
          <Text className="text-brand-700 font-medium">メーターをカメラで読み取り</Text>
        </Pressable>
        {meterBase64 ? <Text className="text-xs text-accent-600">写真を添付しました</Text> : null}
        <Pressable
          className="border border-brand-200 rounded-lg py-2.5 items-center active:opacity-80"
          onPress={() => setInspectionOpenFor("out")}
          disabled={busy || inspectionUploading}
        >
          <Text className="text-brand-700 font-medium">車両点検（前後左右を撮影）</Text>
        </Pressable>
        {inspectionUploading ? (
          <Text className="text-xs text-brand-400">点検写真をアップロード中...</Text>
        ) : outInspectionPaths.length > 0 ? (
          <Text className="text-xs text-accent-600">点検写真を{outInspectionPaths.length}枚添付しました</Text>
        ) : null}
        <View className="flex-row gap-2 mt-1">
          <Pressable
            className="flex-1 bg-accent-500 rounded-lg py-3 items-center active:opacity-80"
            onPress={confirmOut}
            disabled={busy}
          >
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-white font-semibold">業務終了</Text>}
          </Pressable>
          <Pressable
            className="px-4 bg-brand-100 rounded-lg py-3 items-center active:opacity-80"
            onPress={cancelOut}
            disabled={busy}
          >
            <Text className="text-brand-600">やめる</Text>
          </Pressable>
        </View>
      </BottomSheet>

      <MeterScanner
        visible={meterScanFor !== null}
        onConfirm={onMeterConfirmed}
        onClose={() => setMeterScanFor(null)}
      />

      <VehicleInspectionCapture
        visible={inspectionOpenFor !== null}
        onComplete={onInspectionComplete}
        onClose={() => setInspectionOpenFor(null)}
      />

      <QrFallback
        visible={fallbackOpenFor !== null}
        vehicles={fallbackOpenFor === "out" ? outFallbackCandidates : reportVehicles}
        onResolved={fallbackOpenFor === "out" ? onOutFallbackResolved : onInFallbackResolved}
        onClose={() => setFallbackOpenFor(null)}
      />

      <LicenseSpotCheck
        visible={licenseCameraOpen}
        onConfirm={() => {
          setLicenseCameraOpen(false);
          setSafetyPassed(true);
        }}
        onClose={() => setLicenseCameraOpen(false)}
      />
    </ScrollView>
  );
}
