import { Pressable, Text, View } from "react-native";
import { AppIcon } from "./AppIcon";
import type { MeShift, MeShiftRest } from "@repo/core/types";
import { VehicleIdentity } from "./VehiclePlate";
import { fullCourseName, restLabel, shiftDateLabel, shiftDaySummary, shiftTime } from "../shifts/presentation";

const ink = "#192333", muted = "#526074", border = "#E0E6ED";
const restColors = { requested: "#FFF1DA", designated: "#E8EFF8" };
const restColor = (rests: MeShiftRest[]) => rests.some(r => r.kind === "requested") ? restColors.requested : rests.some(r => r.kind === "designated") ? restColors.designated : "white";
const dateOf = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
function RestBadge({ rest }: { rest: MeShiftRest }) {
  return <View style={{ alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: rest.kind === "requested" ? "#FFF1DA" : "#E8EFF8" }}><Text style={{ color: rest.kind === "requested" ? "#85520D" : "#355A84", fontSize: 13, fontWeight: "600" }}>{restLabel(rest)}</Text></View>;
}
function CourseHeading({ shift }: { shift: MeShift }) {
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
    <View style={{ width: 5, alignSelf: "stretch", minHeight: 24, borderRadius: 3, backgroundColor: shift.course_color || "#8995A4" }} />
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={{ color: ink, fontSize: 17, fontWeight: "600", lineHeight: 25, textAlign: "left" }}>{fullCourseName(shift)}</Text><Text style={{ color: muted, fontSize: 12, textAlign: "left" }}>{shift.cycle_label || `${shift.slot}便`}</Text></View>
  </View>;
}

/** 本番ShiftsScreenと隔離ブラウザで共用する月の概観・日別一覧。 */
export function ShiftMonthContent({ year, month, shifts, rests, onSelect, today, restUnavailable = false }: {
  year: number; month: number; shifts: MeShift[]; rests: MeShiftRest[]; onSelect: (date: string) => void; today: string; restUnavailable?: boolean;
}) {
  const prefix = dateOf(year, month, 1).slice(0, 7);
  const byDate = new Map<string, MeShift[]>(), restByDate = new Map<string, MeShiftRest[]>();
  shifts.filter(s => s.shift_date.startsWith(prefix)).forEach(s => byDate.set(s.shift_date, [...(byDate.get(s.shift_date) ?? []), s]));
  rests.filter(r => r.date.startsWith(prefix)).forEach(r => restByDate.set(r.date, [...(restByDate.get(r.date) ?? []), r]));
  const count = new Date(year, month, 0).getDate(), first = new Date(year, month - 1, 1).getDay();
  const rows = Math.ceil((first + count) / 7);
  const dates = [...new Set([...byDate.keys(), ...restByDate.keys()])].sort();
  return <View testID="shift-month-content" style={{ gap: 22 }}>
    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: border, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", paddingVertical: 10, backgroundColor: "#F6F8FB" }}>{["日", "月", "火", "水", "木", "金", "土"].map((d, i) => <Text key={d} style={{ width: "14.2857%", borderLeftWidth: i > 0 ? 1 : 0, borderColor: border, textAlign: "center", color: i === 0 ? "#AF4545" : i === 6 ? "#386394" : muted, fontSize: 12 }}>{d}</Text>)}</View>
      {Array.from({ length: rows }, (_, row) => <View key={row} style={{ flexDirection: "row" }}>{Array.from({ length: 7 }, (_, col) => {
        const day = row * 7 + col - first + 1;
        if (day < 1 || day > count) return <View key={col} style={{ width: "14.2857%", minHeight: 72, borderLeftWidth: col > 0 ? 1 : 0, borderTopWidth: 1, borderColor: border, backgroundColor: "#FAFBFC" }} />;
        const date = dateOf(year, month, day), work = byDate.get(date) ?? [], off = restByDate.get(date) ?? [];
        return <Pressable key={col} testID={`shift-day-${date}`} accessibilityRole="button" accessibilityLabel={`${shiftDateLabel(date)}、${shiftDaySummary(work, off)}`} onPress={() => onSelect(date)} style={{ position: "relative", width: "14.2857%", minHeight: 72, paddingVertical: 7, paddingHorizontal: 1, gap: 3, alignItems: "center", borderTopWidth: 1, borderLeftWidth: col > 0 ? 1 : 0, borderColor: border, backgroundColor: restColor(off) }}>
          <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: date === today ? ink : "transparent" }}><Text style={{ fontSize: 15, fontWeight: date === today ? "700" : "500", color: date === today ? "white" : col === 0 ? "#AF4545" : col === 6 ? "#386394" : ink }}>{day}</Text></View>
          {work.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 3, paddingHorizontal: 4, marginTop: 5 }}>{work.map((s, i) => <View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: s.course_color || "#8995A4" }} />)}</View>}
        </Pressable>;
      })}</View>)}
    </View>
    <View style={{ flexDirection: "row", gap: 18 }}>{(["requested", "designated"] as const).map(kind => <View key={kind} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={{ width: 14, height: 14, borderRadius: 4, borderWidth: 1, borderColor: border, backgroundColor: restColors[kind] }} /><Text style={{ color: muted, fontSize: 12 }}>{kind === "requested" ? "希望休" : "指定休"}</Text></View>)}</View>
    {restUnavailable && <Text accessibilityRole="alert" style={{ color: "#92400E", fontSize: 13 }}>休みの情報を取得できていません。</Text>}
    <Text accessibilityRole="header" style={{ color: ink, fontSize: 19, fontWeight: "700" }}>日別の予定</Text>
    {!dates.length && <Text style={{ color: muted, fontSize: 15 }}>この月の登録はありません。</Text>}
    {dates.map(date => <Pressable key={date} testID={`shift-agenda-${date}`} accessibilityRole="button" accessibilityLabel={`${shiftDateLabel(date)}の詳細、${shiftDaySummary(byDate.get(date) ?? [], restByDate.get(date) ?? [])}`} onPress={() => onSelect(date)} style={{ borderWidth: 1, borderColor: border, padding: 16, borderRadius: 18, backgroundColor: restColor(restByDate.get(date) ?? []), gap: 16, alignItems: "stretch" }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ fontSize: 16, fontWeight: "700", color: ink }}>{shiftDateLabel(date)}</Text><AppIcon name="chevron-right" size={13} color={muted} /></View>
      {(byDate.get(date) ?? []).map((shift, i) => <View key={i} style={{ gap: 12, ...(i > 0 ? { borderTopWidth: 1, borderColor: border, paddingTop: 16 } : {}) }}>
        <CourseHeading shift={shift} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1, gap: 5 }}><Text style={{ color: muted, fontSize: 13, textAlign: "left" }}>集合　{shiftTime(shift.meeting_time)}</Text><Text style={{ color: muted, fontSize: 13, textAlign: "left" }}>退勤予定　{shiftTime(shift.end_time)}</Text></View>
          {shift.vehicle && <VehicleIdentity vehicle={shift.vehicle} width={112} />}
        </View>
      </View>)}
    </Pressable>)}
  </View>;
}

export function ShiftDayDetail({ date, shifts, rests, restUnavailable = false, onClose }: { date: string; shifts: MeShift[]; rests: MeShiftRest[]; restUnavailable?: boolean; onClose: () => void }) {
  return <View testID="shift-day-detail" style={{ gap: 20 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text accessibilityRole="header" style={{ flex: 1, fontSize: 23, fontWeight: "700", color: ink }}>{shiftDateLabel(date)}</Text><Pressable accessibilityRole="button" accessibilityLabel="詳細を閉じる" onPress={onClose} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "#EDF1F5" }}><AppIcon name="xmark" size={18} color={ink} /></Pressable></View>
    {rests.map((rest, i) => <RestBadge key={i} rest={rest} />)}
    {shifts.length > 0 && rests.some(r => r.kind === "requested" && !r.slot_label) && <Text style={{ color: "#92400E", fontSize: 14 }}>希望休とシフトの割当が重なっています。運営へ確認してください。</Text>}
    {restUnavailable && <Text accessibilityRole="alert" style={{ color: "#92400E" }}>休みの情報を取得できていません。</Text>}
    {!shifts.length && <Text style={{ color: muted, fontSize: 16 }}>{rests.some(r => r.kind === "designated" && !r.slot_label) ? "この日は指定休です。" : "シフトの割当はありません。"}</Text>}
    {shifts.map((shift, i) => <View key={i} style={{ gap: 18, borderTopWidth: 1, borderColor: border, paddingTop: 20 }}>
      <CourseHeading shift={shift} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        {[['集合', shift.meeting_time], ['退勤予定', shift.end_time]].map(([label, time]) => <View key={label} style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: "#F3F6FA", gap: 6 }}><Text style={{ color: muted, fontSize: 13 }}>{label}</Text><Text style={{ color: ink, fontSize: 23, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{shiftTime(time)}</Text></View>)}
      </View>
      <View style={{ gap: 6 }}><Text style={{ color: muted, fontSize: 13 }}>集合場所</Text><Text style={{ color: ink, fontSize: 16 }}>{shift.meeting_place?.trim() || "未設定"}</Text></View>
      <View style={{ gap: 12 }}><Text style={{ color: muted, fontSize: 13 }}>使用車両</Text>
        {shift.vehicle ? <VehicleIdentity vehicle={shift.vehicle} /> : <Text style={{ color: ink, fontSize: 16 }}>{shift.uses_external_vehicle ? "持込車両" : shift.vehicle_unavailable ? "車両情報を取得できませんでした" : "車両未割当"}</Text>}
        {shift.vehicle?.is_unavailable && <Text style={{ color: "#B91C1C", fontSize: 14 }}>この車両は利用停止中です。{shift.vehicle.unavailable_reason || "運営へ確認してください。"}</Text>}
      </View>
    </View>)}
  </View>;
}
