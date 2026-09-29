import { ShiftRequestView } from "../../apps/mobile/src/screens/ShiftsScreen";
import { setRequestScenario } from "../../apps/mobile/ui-preview/shift-request-fixture";
import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { ShiftMonthContent, ShiftDayDetail } from "../../apps/mobile/src/components/ShiftSchedule";
import { resolveMonthRests } from "../../apps/mobile/src/shifts/presentation";
import { previewShifts } from "../../apps/mobile/ui-preview/shift-fixture";
import { CaptureReveal } from "./RibbonControl";

export function ShiftReview() {
  const [tab, setTab] = useState("view"), [dirty, setDirty] = useState(false), [requestRevision, setRequestRevision] = useState(0);
  const [month, setMonth] = useState({ year: 2026, month: 9 });
  const [selected, setSelected] = useState<string | null>(null);
  const [scenario, setScenario] = useState("normal");
  const prefix = `${month.year}-${String(month.month).padStart(2, "0")}`;
  const data = previewShifts(prefix);
  if (scenario === "empty") { data.shifts = []; data.rest_days = []; }
  if (scenario === "long-name") data.shifts = data.shifts.map(s => ({ ...s, course_full_name: "京都中央エリア・四条烏丸・西院・桂川周辺への時間指定配送および集荷コース", meeting_place: "中央センター東側の搬入口・管理棟奥の待機スペース" }));
  const rests = resolveMonthRests(month.year, month.month, data.shifts, data.rest_days ?? [], scenario !== "rest-error");
  const change = (delta: number) => { const d = new Date(month.year, month.month - 1 + delta, 1); setMonth({ year: d.getFullYear(), month: d.getMonth() + 1 }); setSelected(null); };
  return <>
    <div role="tablist" style={{ display: "flex", borderBottom: "1px solid #E0E6ED", marginBottom: 12 }}>{[["view", "シフト確認"], ["request", "希望休提出"]].map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => { if (value === tab) return; if (!dirty || window.confirm("希望休の変更を破棄して移動しますか？")) setTab(value); }} style={{ flex: 1, minHeight: 48, borderBottom: tab === value ? "2px solid #192333" : "2px solid transparent", fontWeight: 600 }}>{label}</button>)}</div>
    {tab === "request" ? <><ShiftRequestView key={requestRevision} onDirtyChange={setDirty} /><details style={{ marginTop: 20, fontSize: 12 }}><summary>画面確認</summary>{[["normal", "通常"], ["send-error", "提出失敗"], ["deadline-error", "締切取得失敗"], ["closed", "受付終了"]].map(([value, label]) => <button key={value} onClick={() => { setRequestScenario(value); if (value === "deadline-error" || value === "closed") setRequestRevision(v => v + 1); }} style={{ padding: 10, minHeight: 44 }}>{label}</button>)}</details></> : <>
    <div inert={!!selected}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}><button aria-label="前月" onClick={() => change(-1)} style={{ width: 44, height: 44 }}><FontAwesomeIcon icon={faChevronLeft} /></button><h3 style={{ fontSize: 23, fontWeight: 700 }}>{month.year}年{month.month}月</h3><button aria-label="翌月" onClick={() => change(1)} style={{ width: 44, height: 44 }}><FontAwesomeIcon icon={faChevronRight} /></button></div>
      {scenario === "loading" ? <p role="status">読み込み中…</p> : scenario === "error" ? <div role="alert">シフトを取得できませんでした。<button onClick={() => setScenario("normal")} style={{ display: "block", minHeight: 48 }}>再読み込み</button></div> : <ShiftMonthContent year={month.year} month={month.month} shifts={data.shifts} rests={rests} today="2026-09-24" restUnavailable={scenario === "rest-error"} onSelect={setSelected} />}
      <fieldset style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 24, fontSize: 12 }}><legend>画面確認</legend>{[["normal", "通常"], ["empty", "割当なし"], ["long-name", "長いコース名"], ["loading", "読み込み中"], ["error", "取得失敗"], ["rest-error", "休み取得失敗"]].map(([value, label]) => <button key={value} aria-pressed={scenario === value} onClick={() => setScenario(value)} style={{ minHeight: 44, padding: 8, border: "1px solid #CAD3DF", borderRadius: 8 }}>{label}</button>)}</fieldset>
    </div>
    {selected && <CaptureReveal origin={null} onCancel={() => setSelected(null)}><div role="dialog" aria-modal="true" aria-label="シフトの詳細" style={{ position: "absolute", inset: 0, overflowY: "auto", background: "white", padding: 20 }}><ShiftDayDetail date={selected} shifts={data.shifts.filter(s => s.shift_date === selected)} rests={rests.filter(r => r.date === selected)} restUnavailable={scenario === "rest-error"} onClose={() => setSelected(null)} /></div></CaptureReveal>}
    </>}
  </>;
}
