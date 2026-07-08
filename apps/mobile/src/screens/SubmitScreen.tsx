import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { apiFetch } from "@repo/core/api";
import type { DriverIdentity, SubmitVehicle, ShiftForm, ValueMap, VehiclePlateData } from "@repo/core/types";
import { toLocalDateStr, formatMonthDayJP, reportDateDefaultJST } from "@repo/core/logic/calendar";
import {
  buildInitialValues,
  parseMeter,
  resolveDefaultVehicleId,
  resolveExistingMeter,
  buildReportItems,
  buildVehicleCards,
  groupFieldsByLabel,
} from "@repo/core/logic/dailyReport";

// ============================================================
// 日報提出（submit-v2）。日付→その日のシフト(コース/unit/field)を動的描画→車両/メーター→送信。
// 値構築・整形は Web と同じ @repo/core/logic/dailyReport を再利用。NativeWind。
// ※送信は書き込み（POST /api/reports/v2）。
// ============================================================

const INPUT = "bg-white border border-slate-300 rounded-lg py-2.5 px-3 text-base";
const CHIP = "py-2 px-3.5 rounded-full border";

const addDays = (dateStr: string, delta: number): string => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return toLocalDateStr(d);
};

const plateText = (v: VehiclePlateData): string =>
  [v.number_class, v.number_hiragana, v.number_numeric].filter(Boolean).join(" ") || v.id;

export function SubmitScreen() {
  // 午前3時までは前日扱い（日報の締め時刻）。深夜便の送信で日付がズレて
  // 「未提出」表示になってしまう不具合を避けるため、Web/管理画面と同じ基準日を使う。
  const [reportDate, setReportDate] = useState(() => reportDateDefaultJST());
  const [identities, setIdentities] = useState<DriverIdentity[]>([]);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<SubmitVehicle[]>([]);
  const [unlinked, setUnlinked] = useState<SubmitVehicle[]>([]);
  const [shifts, setShifts] = useState<ShiftForm[]>([]);
  const [shiftVehicleId, setShiftVehicleId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [meter, setMeter] = useState("");
  const [values, setValues] = useState<ValueMap>({});
  const [initLoading, setInitLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
        setVehicles(veh.vehicles ?? []);
        setUnlinked(unl.vehicles ?? []);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "初期データの取得に失敗しました");
      } finally {
        if (alive) setInitLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setFormLoading(true);
    setMessage("");
    apiFetch<{ shifts: ShiftForm[]; shiftVehicleId?: string | null }>(`/api/me/report-form?date=${reportDate}`)
      .then((d) => {
        if (!alive) return;
        const sh = d.shifts ?? [];
        setShifts(sh);
        setShiftVehicleId(d.shiftVehicleId ?? null);
        setValues(buildInitialValues(sh));
        setVehicleId(resolveDefaultVehicleId(sh, d.shiftVehicleId ?? null));
        setMeter(resolveExistingMeter(sh));
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "フォームの取得に失敗しました");
      })
      .finally(() => {
        if (alive) setFormLoading(false);
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

  const submit = async () => {
    if (!identityId) {
      setError("勤務区分が選択されていません");
      return;
    }
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const items = buildReportItems(shifts, values, vehicleId, parseMeter(meter));
      await apiFetch("/api/reports/v2", {
        method: "POST",
        body: JSON.stringify({ reportDate, driverIdentityId: identityId, items }),
      });
      setMessage("日報を送信しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const { cards } = buildVehicleCards({ vehicles, unlinked, vehicleId, shiftVehicleId, showOtherVehicles: false });

  if (initLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-slate-100">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-100" contentContainerClassName="p-4 pt-16 gap-2.5">
      <Text className="text-[26px] font-bold text-slate-900">日報入力</Text>

      <View className="flex-row items-center justify-center gap-5">
        <Pressable className="px-3.5 py-1 rounded-lg bg-slate-200 active:opacity-80" onPress={() => setReportDate((d) => addDays(d, -1))}>
          <Text className="text-xl text-slate-700 leading-6">‹</Text>
        </Pressable>
        <Text className="text-base font-semibold text-slate-900 min-w-[110px] text-center">{formatMonthDayJP(reportDate)}</Text>
        <Pressable className="px-3.5 py-1 rounded-lg bg-slate-200 active:opacity-80" onPress={() => setReportDate((d) => addDays(d, 1))}>
          <Text className="text-xl text-slate-700 leading-6">›</Text>
        </Pressable>
      </View>

      {identities.length > 1 && (
        <View className="flex-row flex-wrap gap-2">
          {identities.map((i) => {
            const on = identityId === i.id;
            return (
              <Pressable key={i.id} className={`${CHIP} ${on ? "bg-slate-900 border-slate-900" : "bg-white border-slate-300"}`} onPress={() => setIdentityId(i.id)}>
                <Text className={`text-[13px] ${on ? "text-white" : "text-slate-700"}`}>{i.label || i.driverCode}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Text className="text-[13px] text-slate-500 mt-2">車両</Text>
      <View className="flex-row flex-wrap gap-2">
        <Pressable className={`${CHIP} ${vehicleId === null ? "bg-slate-900 border-slate-900" : "bg-white border-slate-300"}`} onPress={() => setVehicleId(null)}>
          <Text className={`text-[13px] ${vehicleId === null ? "text-white" : "text-slate-700"}`}>車両なし</Text>
        </Pressable>
        {cards.map((v) => {
          const on = vehicleId === v.id;
          return (
            <Pressable key={v.id} className={`${CHIP} ${on ? "bg-slate-900 border-slate-900" : "bg-white border-slate-300"}`} onPress={() => setVehicleId(v.id)}>
              <Text className={`text-[13px] ${on ? "text-white" : "text-slate-700"}`}>{plateText(v)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text className="text-[13px] text-slate-500 mt-2">メーター（km）</Text>
      <TextInput className={INPUT} value={meter} onChangeText={(t) => setMeter(t.replace(/[^0-9]/g, ""))} keyboardType="number-pad" placeholder="例: 123456" />

      {formLoading ? (
        <View className="py-6 items-center">
          <ActivityIndicator />
        </View>
      ) : shifts.length === 0 ? (
        <Text className="text-slate-400 py-4 text-center">この日のシフトはありません</Text>
      ) : (
        shifts.map((s) => (
          <View key={s.courseId} className="bg-white rounded-[10px] border border-slate-200 p-3 gap-2.5 mt-1.5">
            <Text className="text-base font-bold text-slate-900">{s.courseName}</Text>
            {s.units.map((u) => (
              <View key={u.id} className="gap-1.5">
                <Text className="text-sm font-semibold text-slate-700">{u.name}</Text>
                {groupFieldsByLabel(u.fields).map(([group, fields]) => (
                  <View key={group || "_"} className="gap-1.5 pl-1">
                    {group ? <Text className="text-xs text-slate-500 mt-1">{group}</Text> : null}
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
                            <Text className="text-[13px] text-slate-700">{f.label}</Text>
                            <View className={`w-6 h-6 rounded-md border items-center justify-center ${on ? "bg-slate-900 border-slate-900" : "bg-white border-slate-300"}`}>
                              {on ? <Text className="text-white font-bold">✓</Text> : null}
                            </View>
                          </Pressable>
                        );
                      }
                      return (
                        <View key={f.fieldKey} className="gap-1">
                          <Text className="text-[13px] text-slate-700">{f.label}</Text>
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

      {error ? <Text className="text-red-600 py-1">{error}</Text> : null}
      {message ? <Text className="text-green-600 py-1 font-semibold">{message}</Text> : null}

      <Pressable
        className={`mt-2 bg-slate-900 py-3.5 rounded-lg items-center active:opacity-80 ${shifts.length === 0 || submitting ? "opacity-40" : ""}`}
        onPress={submit}
        disabled={shifts.length === 0 || submitting}
      >
        <Text className="text-white font-bold text-base">{submitting ? "送信中..." : "日報を送信"}</Text>
      </Pressable>
    </ScrollView>
  );
}
