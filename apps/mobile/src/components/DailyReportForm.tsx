import { useEffect, useImperativeHandle, useState, forwardRef } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator } from "react-native";
import { apiFetch } from "@repo/core/api";
import type { DriverIdentity, SubmitVehicle, ShiftForm, ValueMap, VehiclePlateData } from "@repo/core/types";
import {
  buildInitialValues,
  parseMeter as parseReportMeter,
  resolveDefaultVehicleId,
  resolveExistingMeter,
  buildReportItems,
  buildVehicleCards,
  groupFieldsByLabel,
} from "@repo/core/logic/dailyReport";

// 日報入力フォーム（submit-v2）。値構築・整形は Web と同じ @repo/core/logic/dailyReport。
// 退勤フロー（qr_flow v2.0 終了時の確認）と、ホームの「日報を書く」シートの両方から使う。

const INPUT = "border border-brand-200 rounded-lg px-3 py-2.5 text-base bg-white text-brand-900";
const CHIP = "py-2 px-3.5 rounded-full border";

const reportPlateText = (v: VehiclePlateData): string =>
  [v.number_class, v.number_hiragana, v.number_numeric].filter(Boolean).join(" ") || v.id;

export type DailyReportFormHandle = {
  /** 日報を送信する。成功で true。フォームが空（シフト無し）の場合も true を返す。 */
  submit: () => Promise<boolean>;
  /** この日のシフトが1件以上あるか。 */
  hasShifts: () => boolean;
};

export const DailyReportForm = forwardRef<
  DailyReportFormHandle,
  {
    date: string;
    /** 送信成功時に呼ばれる（submit ボタン・外部 submit() どちらでも）。 */
    onSubmitted?: () => void;
    /** true なら内蔵の送信ボタンを表示する（ホームの日報シート用）。退勤フローでは外部の確定ボタンから submit() を呼ぶ。 */
    showSubmitButton?: boolean;
  }
>(function DailyReportForm({ date, onSubmitted, showSubmitButton = false }, ref) {
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
    apiFetch<{ shifts: ShiftForm[]; shiftVehicleId?: string | null }>(`/api/me/report-form?date=${date}`)
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
  }, [date]);

  const setVal = (courseId: string, unitId: string, fieldKey: string, v: string) =>
    setValues((prev) => ({
      ...prev,
      [courseId]: {
        ...prev[courseId],
        [unitId]: { ...prev[courseId]?.[unitId], [fieldKey]: v },
      },
    }));

  const submit = async (): Promise<boolean> => {
    if (shifts.length === 0) return true; // シフトが無い日は送るものが無い＝成功扱い
    if (!identityId) {
      setError("勤務区分が選択されていません");
      return false;
    }
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const items = buildReportItems(shifts, values, vehicleId, parseReportMeter(meter));
      await apiFetch("/api/reports/v2", {
        method: "POST",
        body: JSON.stringify({ reportDate: date, driverIdentityId: identityId, items }),
      });
      setMessage("日報を送信しました");
      onSubmitted?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  useImperativeHandle(ref, () => ({ submit, hasShifts: () => shifts.length > 0 }));

  const { cards } = buildVehicleCards({
    vehicles,
    unlinked,
    vehicleId,
    shiftVehicleId,
    showOtherVehicles: false,
  });

  if (initLoading) {
    return (
      <View className="py-6 items-center">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="gap-2.5">
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
          className={`${CHIP} ${vehicleId === null ? "bg-brand-900 border-brand-900" : "bg-white border-brand-200"}`}
          onPress={() => setVehicleId(null)}
        >
          <Text className={`text-[13px] ${vehicleId === null ? "text-white" : "text-brand-700"}`}>車両なし</Text>
        </Pressable>
        {cards.map((v) => {
          const on = vehicleId === v.id;
          return (
            <Pressable
              key={v.id}
              className={`${CHIP} ${on ? "bg-brand-900 border-brand-900" : "bg-white border-brand-200"}`}
              onPress={() => setVehicleId(v.id)}
            >
              <Text className={`text-[13px] ${on ? "text-white" : "text-brand-700"}`}>{reportPlateText(v)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text className="text-[13px] text-brand-500 mt-2">メーター（km）</Text>
      <TextInput
        className={INPUT}
        value={meter}
        onChangeText={(t) => setMeter(t.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="例: 123456"
      />

      {formLoading ? (
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

      {error ? <Text className="text-red-600 py-1">{error}</Text> : null}
      {message ? <Text className="text-accent-600 py-1 font-semibold">{message}</Text> : null}

      {showSubmitButton && (
        <Pressable
          className={`mt-2 bg-accent-500 py-3.5 rounded-lg items-center active:opacity-80 ${shifts.length === 0 || submitting ? "opacity-40" : ""}`}
          onPress={submit}
          disabled={shifts.length === 0 || submitting}
        >
          <Text className="text-white font-bold text-base">{submitting ? "送信中..." : "日報を送信"}</Text>
        </Pressable>
      )}
    </View>
  );
});
