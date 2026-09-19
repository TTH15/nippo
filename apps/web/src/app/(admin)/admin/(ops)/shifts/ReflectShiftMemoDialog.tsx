"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { EditorModal } from "@/lib/components/EditorModal";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { getDisplayName } from "@/lib/displayName";
import { buildReflectGroups, laneCycleDefault, type ReflectCourse, type ReflectInput, type ReflectLane, type ReflectPerson, type ReflectPreview } from "@/lib/shiftMemo/reflect";
import type { DayOverride } from "@/lib/shiftMemo/board";

const dateLabel = (date: string) => {
  const d = new Date(`${date}T12:00:00`);
  return `${d.getMonth()+1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`;
};
const button = "min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40";
const primary = "min-h-11 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40";

export function ReflectShiftMemoDialog({ dates, courses, drivers, lanes, assignments, dayOverrides, onClose, onApplied }: {
  dates: string[]; courses: ReflectCourse[]; drivers: { id: string; name: string; display_name?: string | null }[];
  lanes: ReflectLane[]; assignments: Record<string, ReflectPerson[]>; dayOverrides: Record<string, DayOverride>;
  onClose: () => void; onApplied: () => Promise<unknown>;
}) {
  const [start, setStart] = useState(dates[0]);
  const [end, setEnd] = useState(dates.at(-1)!);
  const [selectedLaneIds, setSelectedLaneIds] = useState<string[]>([]);
  const [laneCycles, setLaneCycles] = useState<Record<string, string>>(() => Object.fromEntries(lanes.map(lane => [lane.id, laneCycleDefault(lane, courses.find(c => c.id === lane.routeId)!)])));
  const [personMappings, setPersonMappings] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<ReflectInput["mode"]>("add");
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [review, setReview] = useState<{ input: ReflectInput; result: ReflectPreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [finished, setFinished] = useState<ReflectPreview | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [search, setSearch] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 選択リストをスクロールした後でも、差分の件数・失敗理由を先頭から読めるようにする。
    if (contentRef.current?.parentElement) contentRef.current.parentElement.scrollTop = 0;
  }, [review, finished, error]);
  // 共通モーダルのPortal内でフォーカスを保つ。選択肢のPortalも含むため、可視のボタンから判定する。
  useEffect(() => {
    const keepFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      const dialog = dialogs[dialogs.length - 1];
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(el => !el.closest('[inert]') && el.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keepFocus);
    return () => document.removeEventListener("keydown", keepFocus);
  }, []);
  const selectedDates = dates.filter(date => date >= start && date <= end);
  const groupResult = useMemo(() => buildReflectGroups({ dates: selectedDates, lanes, courses, selectedLaneIds, assignments, dayOverrides,
    laneCycles, personMappings, driverIds: drivers.map(d => d.id), includeEmpty: mode === "replace" && includeEmpty }),
  [selectedDates, lanes, courses, selectedLaneIds, assignments, dayOverrides, laneCycles, personMappings, drivers, includeEmpty, mode]);
  const unknownPeople = [...new Map(selectedLaneIds.flatMap(laneId => selectedDates.flatMap(date => assignments[`${laneId}|${date}`] ?? []))
    .filter(p => !p.driverId || !drivers.some(d => d.id === p.driverId)).map(p => [p.personKey, p])).values()];
  const name = (id: string) => { const d = drivers.find(d => d.id === id); return d ? getDisplayName(d) : "登録外のドライバー"; };
  const courseName = (id: string) => courses.find(c => c.id === id)?.summary_title || courses.find(c => c.id === id)?.name || "コース";
  const cycleLabel = (id: string, cycle: number) => cycle ? courses.find(c => c.id === id)?.course_cycles?.find(c => c.cycle_no === cycle)?.label || `C${cycle}` : "";
  const invalid = !selectedLaneIds.length || !selectedDates.length || !groupResult.groups.length || !!groupResult.errors.length;

  const preview = async () => {
    if (busyRef.current || invalid) return;
    busyRef.current = true; setBusy(true); setError("");
    const input = { mode, groups: groupResult.groups };
    try {
      const result = await apiFetch<ReflectPreview>("/api/admin/shifts/memo/reflect", { method: "POST", body: JSON.stringify({ ...input, action: "preview" }) });
      setReview({ input, result });
    } catch (e) { setError(e instanceof Error ? e.message : "変更内容を取得できませんでした。もう一度お試しください。"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const refresh = async () => {
    setRefreshError(false);
    try { await onApplied(); } catch { setRefreshError(true); }
  };
  const apply = async () => {
    if (!review || busyRef.current || finished) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await apiFetch<ReflectPreview>("/api/admin/shifts/memo/reflect", { method: "POST", body: JSON.stringify({ ...review.input, action: "apply", revision: review.result.revision }) });
      setFinished(result);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "反映できませんでした。入力は残っています。変更内容を確認し直してください。");
      // 応答が失われても再確認で既存配置を拾う。確定の連打・見ていない差分の再送を防ぐ。
      setReview(null);
    } finally { busyRef.current = false; setBusy(false); }
  };

  return <>
    <EditorModal title={finished ? "シフトへ反映しました" : "シフトへ反映"} variant="shift" onClose={() => { if (!busyRef.current) onClose(); }} footer={
      finished ? <button type="button" onClick={onClose} className={`${primary} w-full`}>閉じる</button> :
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} onClick={() => review ? (setReview(null), setError("")) : onClose()} className={button}>{review ? "対象を選び直す" : "キャンセル"}</button>
        {review ? <button type="button" disabled={busy || review.result.added + review.result.removed === 0} onClick={() => setConfirm(true)} className={primary}>{busy ? "反映中…" : "この内容で反映"}</button>
          : <button type="button" disabled={busy || invalid} onClick={() => void preview()} className={primary}>{busy ? "確認中…" : "変更内容を確認"}</button>}
      </div>
    }>
      <div ref={contentRef} className="space-y-4 text-xs">
        {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 leading-5 text-rose-700">{error}</p>}
        {finished ? <div role="status" className="space-y-3">
          <p className="font-semibold text-emerald-700">追加 {finished.added}件・解除 {finished.removed}件</p>
          <p className="text-slate-600">シフト表で確認できます。メモはそのまま残っています。</p>
          {refreshError && <p role="alert" className="text-amber-800">反映は完了しました。シフト表の読み込みをやり直してください。<button type="button" className={`${button} mt-2`} onClick={() => void refresh()}>シフト表を再読込</button></p>}
        </div> : review ? <>
          <p className="font-semibold">{dateLabel(start)}〜{dateLabel(end)}</p>
          <p className="rounded-lg bg-slate-100 p-3 font-semibold">追加 {review.result.added}件・解除 {review.result.removed}件・変更なし {review.result.kept}件</p>
          <p className="text-slate-500">同じ人でもC1・C2は別々に数えます。</p>
          {review.result.removed > 0 && <p className="rounded-lg bg-amber-50 p-3 leading-5 text-amber-900">解除する人の車両・個別の集合時刻も外れます。変更がない人の配車は残ります。</p>}
          {review.result.warnings.length > 0 && <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <h3 className="mb-2 font-semibold text-amber-900">予定を確認してください</h3>
            <ul className="space-y-1 text-amber-900">{review.result.warnings.map((w, i) => <li key={i}>{dateLabel(w.date)} {name(w.driverId)}：{w.kind === "off" ? "希望休あり" : `${w.courseName}にも配置`}</li>)}</ul>
          </section>}
          {review.result.added + review.result.removed === 0 ? <p className="py-4 text-center text-slate-600">変更する配置はありません。</p> :
            <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">{review.result.changes.filter(c => c.addIds.length + c.removeIds.length > 0).map(change => <section key={`${change.date}|${change.courseId}|${change.cycleNo}`} className="space-y-2 p-3">
              <h3 className="break-words font-semibold text-slate-800">{dateLabel(change.date)} {courseName(change.courseId)} {cycleLabel(change.courseId, change.cycleNo)}</h3>
              {change.addIds.length > 0 && <p className="break-words leading-5 text-emerald-800">追加：{change.addIds.map(name).join("、")}</p>}
              {change.removeIds.length > 0 && <p className="break-words leading-5 text-rose-700">解除：{change.removeIds.map(name).join("、")}</p>}
            </section>)}</div>}
        </> : <fieldset disabled={busy} className="min-w-0 space-y-4">
          <p className="leading-5 text-slate-600">メモの配置をシフト表へ反映します。担当枠と期間を選んでください。</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><p className="mb-1 font-semibold">開始日</p><CustomSelect clearable={false} ariaLabel="反映の開始日" value={start} onChange={setStart} options={dates.map(date => ({ value: date, label: dateLabel(date) }))}/></div>
            <div><p className="mb-1 font-semibold">終了日</p><CustomSelect clearable={false} ariaLabel="反映の終了日" value={end} onChange={setEnd} options={dates.filter(date => date >= start).map(date => ({ value: date, label: dateLabel(date) }))}/></div>
          </div>
          {start > end && <p role="alert" className="text-rose-700">終了日を開始日以降にしてください。</p>}
          <div><p className="mb-1 font-semibold">反映方法</p><CustomSelect clearable={false} ariaLabel="反映方法" value={mode} onChange={value => setMode(value as ReflectInput["mode"])} options={[
            { value: "add", label: "今のシフトに追加" }, { value: "replace", label: "メモに合わせて入れ替え" },
          ]}/></div>
          <SmoothCollapse open={mode === "replace"}><div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="leading-5 text-amber-900">対象の日・コース・便では、選んだ担当枠にいない人の配置を解除します。同じ便の担当枠はまとめて選んでください。</p>
            <CheckboxField label="配置のない日も空にする" checked={includeEmpty} onCheckedChange={setIncludeEmpty}/>
          </div></SmoothCollapse>
          <section className="space-y-2">
            <h3 className="font-semibold">担当枠・反映先の便</h3>
            <input aria-label="担当枠を検索" placeholder="コース・担当枠を検索" value={search} onChange={e => setSearch(e.target.value)} className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"/>
            {lanes.length === 0 && <p className="text-slate-500">反映できる担当枠がありません。</p>}
            {lanes.filter(lane => `${lane.name} ${courseName(lane.routeId)}`.includes(search)).map(lane => {
              const course = courses.find(c => c.id === lane.routeId)!;
              const selected = selectedLaneIds.includes(lane.id);
              return <div key={lane.id} className="rounded-lg border border-slate-200 p-2">
                <CheckboxField label={courseName(lane.routeId) === lane.name ? lane.name : `${courseName(lane.routeId)} / ${lane.name}`} checked={selected} onCheckedChange={checked => setSelectedLaneIds(ids => checked ? [...ids, lane.id] : ids.filter(id => id !== lane.id))}/>
                <SmoothCollapse open={selected && !!course.uses_cycles} speed="quick"><div className="px-2 pb-2"><CustomSelect clearable={false} ariaLabel={`${courseName(lane.routeId)} ${lane.name}の反映先の便`} value={laneCycles[lane.id]} onChange={value => setLaneCycles(current => ({ ...current, [lane.id]: value }))} placeholder="便を選択" options={[
                  ...(course.course_cycles ?? []).filter(c => c.active !== false).map(c => ({ value: String(c.cycle_no), label: c.label || `C${c.cycle_no}` })),
                  { value: "all", label: "すべての便に同じ人を配置" },
                ]}/></div></SmoothCollapse>
              </div>;
            })}
            <p className="text-slate-500">選択中 {selectedLaneIds.length}枠</p>
          </section>
          {unknownPeople.length > 0 && <section className="space-y-3 rounded-lg border border-amber-200 p-3">
            <h3 className="font-semibold">名前札と登録ドライバーを合わせる</h3>
            {unknownPeople.map(person => <div key={person.personKey}><p className="mb-1 break-words">{person.name}</p><CustomSelect ariaLabel={`${person.name}の登録ドライバー`} value={personMappings[person.personKey]} onChange={value => setPersonMappings(current => ({ ...current, [person.personKey]: value }))} placeholder="ドライバーを選択" options={drivers.map(driver => ({ value: driver.id, label: `${getDisplayName(driver)}（${driver.name}）` }))}/></div>)}
          </section>}
          {groupResult.errors.length > 0 && <ul className="space-y-1 leading-5 text-rose-700">{groupResult.errors.map(message => <li key={message}>{message}</li>)}</ul>}
          {selectedLaneIds.length > 0 && !groupResult.groups.length && !groupResult.errors.length && <p className="text-slate-500">この期間に反映する配置がありません。</p>}
        </fieldset>}
      </div>
    </EditorModal>
    <ConfirmDialog open={confirm} title="シフトへ反映しますか？" message={`追加 ${review?.result.added ?? 0}件・解除 ${review?.result.removed ?? 0}件を保存します。${review?.result.warnings.length ? "\n希望休・ほかのコースとの重複も確認してください。" : ""}`} confirmLabel="シフトへ反映する" tone="neutral" onConfirm={() => void apply()} onClose={() => setConfirm(false)}/>
  </>;
}
