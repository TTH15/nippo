import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { apiFetch } from "@repo/core/api";
import type { DriverIdentity, SubmitVehicle, ShiftForm, ValueMap, VehiclePlateData } from "@repo/core/types";
import { toLocalDateStr, formatMonthDayJP } from "@repo/core/logic/calendar";
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
// 日報提出（submit-v2）の RN 移植・第1弾。
// 日付→その日のシフト(コース/unit/field)を動的描画→車両/メーター→送信。
// 値構築・整形は Web と同じ @repo/core/logic/dailyReport を再利用（buildReportItems 等）。
// オイル警告モーダル・送信後画面・添付・車両プレート描画は次段。
// ※送信は書き込み（POST /api/reports/v2）。
// ============================================================

const addDays = (dateStr: string, delta: number): string => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return toLocalDateStr(d);
};

const plateText = (v: VehiclePlateData): string =>
  [v.number_class, v.number_hiragana, v.number_numeric].filter(Boolean).join(" ") || v.id;

export function SubmitScreen() {
  const [reportDate, setReportDate] = useState(() => toLocalDateStr(new Date()));
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

  // 初期データ（identities / vehicles / unlinked）を合成取得（Web の me/submit-init 相当）。
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

  // 日付ごとのフォーム（その日のシフト）を取得。
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
      <View style={styles.centerFull}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.title}>日報入力</Text>

      {/* 日付 */}
      <View style={styles.dateRow}>
        <Pressable style={styles.navBtn} onPress={() => setReportDate((d) => addDays(d, -1))}>
          <Text style={styles.navBtnText}>‹</Text>
        </Pressable>
        <Text style={styles.dateLabel}>{formatMonthDayJP(reportDate)}</Text>
        <Pressable style={styles.navBtn} onPress={() => setReportDate((d) => addDays(d, 1))}>
          <Text style={styles.navBtnText}>›</Text>
        </Pressable>
      </View>

      {/* 勤務区分（複数時のみ） */}
      {identities.length > 1 && (
        <View style={styles.chipRow}>
          {identities.map((i) => (
            <Pressable
              key={i.id}
              style={[styles.chip, identityId === i.id && styles.chipActive]}
              onPress={() => setIdentityId(i.id)}
            >
              <Text style={[styles.chipText, identityId === i.id && styles.chipTextActive]}>
                {i.label || i.driverCode}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* 車両 */}
      <Text style={styles.section}>車両</Text>
      <View style={styles.chipRow}>
        <Pressable style={[styles.chip, vehicleId === null && styles.chipActive]} onPress={() => setVehicleId(null)}>
          <Text style={[styles.chipText, vehicleId === null && styles.chipTextActive]}>車両なし</Text>
        </Pressable>
        {cards.map((v) => (
          <Pressable key={v.id} style={[styles.chip, vehicleId === v.id && styles.chipActive]} onPress={() => setVehicleId(v.id)}>
            <Text style={[styles.chipText, vehicleId === v.id && styles.chipTextActive]}>{plateText(v)}</Text>
          </Pressable>
        ))}
      </View>

      {/* メーター */}
      <Text style={styles.section}>メーター（km）</Text>
      <TextInput
        style={styles.input}
        value={meter}
        onChangeText={(t) => setMeter(t.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="例: 123456"
      />

      {/* 動的フィールド */}
      {formLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : shifts.length === 0 ? (
        <Text style={styles.empty}>この日のシフトはありません</Text>
      ) : (
        shifts.map((s) => (
          <View key={s.courseId} style={styles.shiftCard}>
            <Text style={styles.courseName}>{s.courseName}</Text>
            {s.units.map((u) => (
              <View key={u.id} style={styles.unit}>
                <Text style={styles.unitName}>{u.name}</Text>
                {groupFieldsByLabel(u.fields).map(([group, fields]) => (
                  <View key={group || "_"} style={styles.group}>
                    {group ? <Text style={styles.groupLabel}>{group}</Text> : null}
                    {fields.map((f) => {
                      const raw = values[s.courseId]?.[u.id]?.[f.fieldKey] ?? "";
                      if (f.inputType === "BOOL") {
                        const on = raw === "true";
                        return (
                          <Pressable
                            key={f.fieldKey}
                            style={styles.boolRow}
                            onPress={() => setVal(s.courseId, u.id, f.fieldKey, on ? "false" : "true")}
                          >
                            <Text style={styles.fieldLabel}>{f.label}</Text>
                            <View style={[styles.checkbox, on && styles.checkboxOn]}>
                              {on ? <Text style={styles.checkMark}>✓</Text> : null}
                            </View>
                          </Pressable>
                        );
                      }
                      return (
                        <View key={f.fieldKey} style={styles.field}>
                          <Text style={styles.fieldLabel}>{f.label}</Text>
                          <TextInput
                            style={styles.input}
                            value={raw}
                            onChangeText={(t) =>
                              setVal(
                                s.courseId,
                                u.id,
                                f.fieldKey,
                                f.inputType === "INT" ? t.replace(/[^0-9]/g, "") : t,
                              )
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

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}

      <Pressable
        style={[styles.submit, (shifts.length === 0 || submitting) && styles.submitDisabled]}
        onPress={submit}
        disabled={shifts.length === 0 || submitting}
      >
        <Text style={styles.submitText}>{submitting ? "送信中..." : "日報を送信"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#f1f5f9" },
  content: { padding: 16, paddingTop: 64, gap: 10 },
  centerFull: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f1f5f9" },
  center: { paddingVertical: 24, alignItems: "center" },
  title: { fontSize: 26, fontWeight: "700", color: "#0f172a" },
  dateRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 },
  navBtn: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 8, backgroundColor: "#e2e8f0" },
  navBtnText: { fontSize: 20, color: "#334155", lineHeight: 24 },
  dateLabel: { fontSize: 16, fontWeight: "600", color: "#0f172a", minWidth: 110, textAlign: "center" },
  section: { fontSize: 13, color: "#64748b", marginTop: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: "#cbd5e1", backgroundColor: "#fff" },
  chipActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  chipText: { fontSize: 13, color: "#334155" },
  chipTextActive: { color: "#fff" },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, fontSize: 16 },
  shiftCard: { backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", padding: 12, gap: 10, marginTop: 6 },
  courseName: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  unit: { gap: 6 },
  unitName: { fontSize: 14, fontWeight: "600", color: "#334155" },
  group: { gap: 6, paddingLeft: 4 },
  groupLabel: { fontSize: 12, color: "#64748b", marginTop: 4 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 13, color: "#334155" },
  boolRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  checkboxOn: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  checkMark: { color: "#fff", fontWeight: "700" },
  empty: { color: "#94a3b8", paddingVertical: 16, textAlign: "center" },
  error: { color: "#dc2626", paddingVertical: 4 },
  success: { color: "#16a34a", paddingVertical: 4, fontWeight: "600" },
  submit: { marginTop: 8, backgroundColor: "#0f172a", paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
