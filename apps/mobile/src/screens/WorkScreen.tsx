import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator, ScrollView } from "react-native";
import {
  fetchToday,
  resolveQr,
  checkIn,
  checkOut,
  uploadMeterPhoto,
  plateText,
  type WorkSession,
  type ResolvedVehicle,
} from "../api/work";
import { getGps } from "../location";
import { PunchButton } from "../components/PunchButton";
import { BottomSheet } from "../components/BottomSheet";
import { MeterScanner } from "../components/MeterScanner";
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

export function WorkScreen() {
  // --- 出退勤（Phase1: QR認証 → Bottom Sheet） ---
  const [workLoading, setWorkLoading] = useState(true);
  const [open, setOpen] = useState<WorkSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [workMsg, setWorkMsg] = useState<string | null>(null);

  const [inVehicle, setInVehicle] = useState<ResolvedVehicle | null>(null);
  const [inToken, setInToken] = useState<string | null>(null);
  const [inMeter, setInMeter] = useState("");

  const [outToken, setOutToken] = useState<string | null>(null);
  const [outMeter, setOutMeter] = useState("");

  const [meterScanFor, setMeterScanFor] = useState<"in" | "out" | null>(null);
  const [meterBase64, setMeterBase64] = useState<string | null>(null);

  function onMeterConfirmed(value: number | null, base64: string) {
    if (value != null) {
      if (meterScanFor === "in") setInMeter(String(value));
      else if (meterScanFor === "out") setOutMeter(String(value));
    }
    setMeterBase64(base64);
    setMeterScanFor(null);
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
      return true;
    } catch (e) {
      setWorkMsg(errMsg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmIn() {
    if (!inToken) return;
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
        token: inToken,
        odometer: parseMeter(inMeter),
        lat: gps.lat,
        lng: gps.lng,
        gpsStatus: gps.status,
        odometerPhotoPath,
      });
      if (!res.ok) {
        setWorkMsg(res.message ?? "出勤に失敗しました。");
        return;
      }
      setInVehicle(null);
      setInToken(null);
      setInMeter("");
      setMeterBase64(null);
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
    setWorkMsg(null);
  }

  async function onScanOut(data: string): Promise<boolean> {
    if (!open) return false;
    setOutToken(data);
    return true;
  }

  async function confirmOut() {
    if (!open || !outToken) return;
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
        token: outToken,
        odometer: parseMeter(outMeter),
        lat: gps.lat,
        lng: gps.lng,
        gpsStatus: gps.status,
        odometerPhotoPath,
      });
      if (!res.ok) {
        setWorkMsg(res.message ?? "業務終了に失敗しました。");
        return;
      }
      setOutToken(null);
      setOutMeter("");
      setMeterBase64(null);
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

        <PunchButton mode={open ? "end" : "start"} busy={busy} onScanned={open ? onScanOut : onScanIn} />
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

      {/* 出勤: QR認証後の車両確認・メーター入力 */}
      <BottomSheet visible={inVehicle !== null}>
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
      <BottomSheet visible={outToken !== null}>
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
    </ScrollView>
  );
}
