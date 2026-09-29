import { VehicleIdentity } from "./VehiclePlate";
import { useEffect, useImperativeHandle, useState, forwardRef } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator } from "react-native";
import { AppIcon } from "./AppIcon";
import { apiFetch } from "@repo/core/api";
import type {
  DriverIdentity,
  SubmitVehicle,
  ShiftForm,
  ValueMap,
  VehiclePlateData,
} from "@repo/core/types";
import {
  buildInitialValues,
  resolveDefaultVehicleId,
  buildVehicleCards,
  groupFieldsByLabel,
  reportFormKey,
} from "@repo/core/logic/dailyReport";
import { buildPhotoReportItems } from "../reports/photo-report";
import { ReportSourceImagePicker } from "./ReportSourceImagePicker";
import { applyImageEntries } from "@repo/core/logic/reportImageEntries";

// 日報入力フォーム（submit-v2）。値構築・整形は Web と同じ @repo/core/logic/dailyReport。
// 稼働中・終了後のホームから使う。駐車記録は独立APIへ送る。

const INPUT = "border border-brand-200 rounded-xl px-4 py-3 text-xl bg-white text-brand-900";
const CHIP = "min-h-12 justify-center py-3 px-4 rounded-xl border";

export type DailyReportFormHandle = {
  /** 日報を送信する。フォームが空（シフト無し）の場合も成功を返す。 */
  submit: () => Promise<DailyReportSubmitResult>;
  /** この日のシフトが1件以上あるか。 */
  hasShifts: () => boolean;
};

export type DailyReportSubmitResult = {
  ok: boolean;
};

export const DailyReportForm = forwardRef<
  DailyReportFormHandle,
  {
    date: string;
    /** QRで確定した車両。未指定時は既存日報/割当情報を表示する。 */
    confirmedVehicle?: VehiclePlateData;
    /** 送信成功時に呼ばれる（submit ボタン・外部 submit() どちらでも）。 */
    onSubmitted?: () => void;
    /** true なら内蔵の送信ボタンを表示する。 */
    showSubmitButton?: boolean;
  }
>(function DailyReportForm({ date, confirmedVehicle, onSubmitted, showSubmitButton = false }, ref) {
  const [identities, setIdentities] = useState<DriverIdentity[]>([]);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<SubmitVehicle[]>([]);
  const [unlinked, setUnlinked] = useState<SubmitVehicle[]>([]);
  const [shifts, setShifts] = useState<ShiftForm[]>([]);
  const [shiftVehicleId, setShiftVehicleId] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
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

  const setVal = (formKey: string, unitId: string, fieldKey: string, v: string) =>
    setValues((prev) => ({
      ...prev,
      [formKey]: {
        ...prev[formKey],
        [unitId]: { ...prev[formKey]?.[unitId], [fieldKey]: v },
      },
    }));

  const submit = async (): Promise<DailyReportSubmitResult> => {
    if (initLoading || formLoading || submitting) return { ok: false };
    if (shifts.length === 0) return { ok: true }; // シフトが無い日は送るものが無い＝成功扱い
    if (!identityId) {
      setError("勤務区分が選択されていません");
      return { ok: false };
    }
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const items = buildPhotoReportItems(shifts, values, confirmedVehicle?.id ?? vehicleId);
      await apiFetch("/api/reports/v2", {
        method: "POST",
        body: JSON.stringify({ reportDate: date, driverIdentityId: identityId, items }),
      });
      setMessage("日報を送信しました");
      onSubmitted?.();
      return { ok: true };
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
      return { ok: false };
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
    <View className="gap-4">
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

      <View className="gap-3 py-2">
        <Text className="text-sm text-brand-500">使用車両</Text>
        {confirmedVehicle || cards.find(v => v.id === vehicleId) ? <VehicleIdentity vehicle={(confirmedVehicle ?? cards.find(v => v.id === vehicleId))!} />
          : <Text className="text-brand-500">{formLoading ? "確認中…" : vehicleId ? "車両情報を確認できません" : "使用車両の記録がありません"}</Text>}
      </View>

      {formLoading ? (
        <View className="py-6 items-center">
          <ActivityIndicator />
        </View>
      ) : shifts.length === 0 ? (
        <Text className="text-brand-300 py-4 text-center">この日のシフトはありません</Text>
      ) : (
        shifts.map((s) => {
          const formKey = reportFormKey(s.courseId, s.cycleNo);
          const cycleLabel = s.cycleLabel || `C${s.cycleNo ?? 0}`;
          return (
            <View key={formKey} className="bg-white rounded-2xl border border-brand-200 p-4 gap-5 mt-2">
              <Text className="text-base font-bold text-brand-900">
                {s.courseName}{(s.cycleNo ?? 0) > 0 ? `  ${cycleLabel}` : ""}
              </Text>
              <ReportSourceImagePicker
                key={`${date}:${formKey}`}
                date={date}
                courseId={s.courseId}
                onApply={(entries) => setValues((prev) => applyImageEntries(prev, [s], entries).values)}
              />
              {s.units.map((u) => (
              <View key={u.id} className="gap-4">
                <Text className="text-sm font-semibold text-brand-700">{u.name}</Text>
                {groupFieldsByLabel(u.fields).map(([group, fields]) => (
                  <View key={group || "_"} className="gap-4">
                    {group ? <Text className="text-xs text-brand-500 mt-1">{group}</Text> : null}
                    {fields.map((f) => {
                      const raw = values[formKey]?.[u.id]?.[f.fieldKey] ?? "";
                      if (f.inputType === "BOOL") {
                        const on = raw === "true";
                        return (
                          <Pressable
                            key={f.fieldKey}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: on }}
                            className="flex-row items-center justify-between gap-3 min-h-14 py-3"
                            onPress={() => setVal(formKey, u.id, f.fieldKey, on ? "false" : "true")}
                          >
                            <Text className="text-base font-medium text-brand-700">{f.label}</Text>
                            <View
                              className={`w-6 h-6 rounded-md border items-center justify-center ${on ? "bg-brand-900 border-brand-900" : "bg-white border-brand-200"}`}
                            >
                              {on ? <AppIcon name="check" size={14} color="white" /> : null}
                            </View>
                          </Pressable>
                        );
                      }
                      return (
                        <View key={f.fieldKey} className="gap-2">
                          <Text className="text-base font-medium text-brand-700">{f.label}</Text>
                          <TextInput
                            className={INPUT}
                            style={{ minHeight: 56 }}
                            accessibilityLabel={`${s.courseName} ${cycleLabel} ${f.label}`}
                            value={raw}
                            onChangeText={(t) =>
                              setVal(formKey, u.id, f.fieldKey, f.inputType === "INT" ? t.replace(/[^0-9]/g, "") : t)
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
          );
        })
      )}

      {error ? <Text className="text-red-600 py-1">{error}</Text> : null}
      {message ? <Text className="text-accent-600 py-1 font-semibold">{message}</Text> : null}

      {showSubmitButton && (
        <Pressable
          className={`mt-2 min-h-14 justify-center bg-accent-500 py-4 rounded-xl items-center active:opacity-80 ${shifts.length === 0 || submitting ? "opacity-40" : ""}`}
          onPress={() => void submit()}
          disabled={initLoading || formLoading || shifts.length === 0 || submitting}
        >
          <Text className="text-white font-bold text-base">{submitting ? "送信中..." : "日報を送信"}</Text>
        </Pressable>
      )}
    </View>
  );
});
