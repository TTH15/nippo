"use client";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faCheck, faChevronLeft, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { AdminPreviewLayout } from "./AdminPreviewLayout";
import { PreviewNavigation } from "./layout-adapters";
import { filterDrivers, initialDemo } from "./model";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { PAGE_NAMES, initialShiftView, viewAtDate, type PreviewTarget, type ShiftView } from "./navigation";
import ShiftBoard from "./ShiftBoard";
import { DriverBoard } from "./DriverBoard";
import { ParkingPlacesEditor } from "./ParkingPlacesEditor";
import { previewConnectionLabel } from "./mapbox-config";

const PATHS = { shifts: "/admin/shifts", drivers: "/admin/users" } as const;
type Page = keyof typeof PATHS;
export default function LeaseAdminPreview() {
  const [demo, setDemo] = useState(initialDemo);
  const [target, setTarget] = useState<PreviewTarget>({ page: "shifts" });
  const page = target.page;
  const [shiftView, setShiftView] = useState(initialShiftView);
  const [history, setHistory] = useState<{ target: PreviewTarget; view: ShiftView }[]>([]);
  const [showScenarios, setShowScenarios] = useState(false);
  const [showPreviewTools, setShowPreviewTools] = useState(false);
  const [parkingOpen, setParkingOpen] = useState(false);
  const [scenario, setScenario] = useState("");
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<{ title: string; message: string; action: () => void; confirmLabel: string } | null>(null);
  useEffect(() => {
    setShiftView(previous => {
      const labelIds = previous.labelIds.filter(id => id === "unlabeled" || demo.labels.some(label => label.id === id));
      return labelIds.length === previous.labelIds.length ? previous : { ...previous, labelIds };
    });
  }, [demo.labels, shiftView.labelIds]);
  const confirm = (title: string, message: string, action: () => void, confirmLabel: string) => setConfirmation({ title, message, action, confirmLabel });
  const guard = (action: () => void) => dirty ? confirm("変更を破棄しますか？", "保存していない入力は失われます。", () => { setDirty(false); action(); }, "破棄する") : action();
  const navigate = (next: PreviewTarget, saved = false, root = false) => {
    const action = () => {
      setDirty(false);
      setParkingOpen(false);
      setHistory(h => root ? [] : [...h, { target, view: shiftView }]);
      if (next.page === "shifts" && next.date) {
        const visible = !next.driverId || (!saved && filterDrivers(demo, shiftView.labelIds, shiftView.mode, shiftView.query).some(d => d.id === next.driverId));
        setShiftView(viewAtDate(visible ? shiftView : { ...shiftView, labelIds: [], mode: "all", query: "" }, next.date));
      }
      setTarget(next); setRevision(r => r + 1);
      if (!saved) setNotice("");
    };
    if (saved) action(); else guard(action);
  };
  const back = () => guard(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setTarget(previous.target); setShiftView(previous.view); setHistory(h => h.slice(0, -1)); setDirty(false); setParkingOpen(false); setRevision(r => r + 1);
  });
  const loadScenario = (id: "loan" | "contract" | "conflict" | "places" | "monthly" | "replacement" | "link-change" | "save-error") => confirm("サンプルを切り替えますか？", "保存済みの変更と入力中の内容を初期化し、選んだ架空データで試します。本番には影響しません。", () => {
    const data = initialDemo();
    let next: PreviewTarget;
    if (id === "save-error") {
      next = { page: "drivers", driverId: "sato", date: "2026-09-07", repairSave: true };
      setScenario("月額料金やラベルを変更して保存 → 契約だけ失敗して入力が残ることを確認 → 未保存の項目を再試行。本番と同じ部分保存処理・失敗表示を使用し、通信はしません。");
    } else if (id === "monthly") {
      next = { page: "shifts", driverId: "tanaka", date: "2026-09-07" };
      setScenario("田中さん（月額）の車両に1201を選択 → 佐藤さんへの駐車案内と、田中さんへの受取・返却案内を確認。普段の紐付けは2345のままです。");
    } else if (id === "replacement") {
      data.loans = [];
      data.vehicles = data.vehicles.map(vehicle => vehicle.id === "v1" ? { ...vehicle, unavailable: true } : vehicle);
      next = { page: "shifts", driverId: "sato", date: "2026-09-08" };
      setScenario("佐藤さんの普段の車両1201が整備中。空いている5678を選択して当日だけ代車に変更。紐付け・月額契約・前後の日の配車は変わりません。");
    } else if (id === "link-change") {
      next = { page: "drivers", driverId: "sato", date: "2026-09-16" };
      setScenario("9/16から普段使う車両を6789へ変更して保存 → 再表示して紐付け履歴を確認。9/15以前の紐付け・配車・貸出通知先は維持します。");
    } else if (id === "places") {
      data.loans = []; data.parkingPlaces = [];
      next = { page: "shifts", driverId: "takahashi", date: "2026-09-07" };
      setScenario("車両に1201を選択 → 駐車場所を登録 → 受取・返却場所を選択して配車。");
    } else if (id === "loan") {
      data.loans = [];
      next = { page: "shifts", driverId: "takahashi", date: "2026-09-07" };
      setScenario("高橋さんの車両に1201を選択 → 月額車の通知内容を確認して配車。佐藤さんはこの日、希望休です。");
    } else if (id === "contract") {
      next = { page: "drivers", driverId: "ito", date: "2026-09-07" };
      setScenario("伊藤さんを月額に変更し、普段使う車両に5678を選択 → 保存してシフトを確認 → 日額に戻して比較");
    } else {
      next = { page: "shifts", driverId: "sato", date: "2026-09-02" };
      setScenario("佐藤さんの希望休を解除し、コースを追加 → 1201は貸出中のため選べません。別の空いている車両で稼働でき、貸出は維持します。");
    }
    setDemo(data); setTarget(next); setShiftView(viewAtDate(initialShiftView(), next.date!)); setHistory([]); setDirty(false); setParkingOpen(false); setNotice(""); setRevision(r => r + 1); setShowScenarios(false);
  }, "切り替える");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500); return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const handle = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", handle); return () => window.removeEventListener("beforeunload", handle);
  }, [dirty]);
  const props = { demo, setDemo, notify: setNotice, setDirty, guard, confirm, target, navigate, replaceTarget: setTarget };
  const onNavigate = (href: string) => {
    const next = (Object.keys(PATHS) as Page[]).find(key => PATHS[key] === href);
    if (next) navigate({ page: next }, false, true);
    else setNotice("このプレビューではシフトの配車と、ドライバー一覧の契約・ラベル編集を試せます。その他のメニューは配置確認用です");
  };
  const reset = () => confirm("サンプルを初期化しますか？", "プレビュー内の編集をリセットします。本番データは変更されません。", () => { setDemo(initialDemo()); setTarget({ page: "shifts" }); setShiftView(initialShiftView()); setHistory([]); setScenario(""); setDirty(false); setParkingOpen(false); setRevision(r => r + 1); setNotice("サンプルを初期化しました"); }, "初期化する");
  return <div data-mode="admin" className="min-h-screen bg-[var(--color-bg)] max-md:bg-[var(--mode-admin-bg)]">
    <PreviewNavigation.Provider value={onNavigate}>
      <AdminPreviewLayout pathname={PATHS[page]} onReset={reset}>
        <section className="mb-2 border-b border-slate-200" aria-label="プレビューの操作">
          <div className="flex min-h-9 items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>管理プレビュー<span className="ml-2 hidden sm:inline">架空データ・{previewConnectionLabel}</span></span>
            <button type="button" id="preview-tools-toggle" className="inline-flex min-h-11 items-center gap-2 px-2 text-xs sm:min-h-9" aria-expanded={showPreviewTools} aria-controls="preview-tools" onClick={() => setShowPreviewTools(open => !open)}>プレビュー操作<FontAwesomeIcon icon={faChevronDown}/></button>
          </div>
          <SmoothCollapse open={showPreviewTools} id="preview-tools" labelledBy="preview-tools-toggle">
            <div className="flex flex-wrap items-center gap-1.5 py-2" role="group" aria-label="プレビューの画面">
              {(Object.keys(PAGE_NAMES) as Page[]).map(key => <button key={key} aria-pressed={page === key} className={`min-h-11 rounded-lg px-3 text-xs font-medium ${page === key ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`} onClick={() => navigate({ page: key }, false, true)}>{PAGE_NAMES[key]}</button>)}
              <button className="min-h-11 rounded-lg px-3 text-xs font-medium text-slate-600 hover:bg-slate-50" onClick={() => guard(() => setParkingOpen(true))}>駐車場所</button>
              <button className="ml-auto min-h-11 px-2 text-xs text-slate-500" aria-expanded={showScenarios} aria-controls="lease-scenarios" onClick={() => setShowScenarios(v => !v)}>試すサンプル<FontAwesomeIcon icon={faChevronDown} className="ml-2"/></button>
            </div>
            <SmoothCollapse open={showScenarios} id="lease-scenarios"><div className="flex flex-wrap gap-2 border-t border-slate-100 py-3">{([["save-error", "契約保存の失敗と再試行"], ["loan", "月額車を配車"], ["monthly", "月額同士の貸し借り"], ["replacement", "整備中の代車"], ["link-change", "月途中の紐付け変更"], ["contract", "日額から月額へ"], ["conflict", "貸出とシフトの競合"], ["places", "駐車場所が未設定"]] as const).map(([id, title]) => <button key={id} className="min-h-11 rounded-lg border border-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-50" onClick={() => loadScenario(id)}>{title}</button>)}<p className="w-full text-[11px] text-slate-500">切替時に編集内容を初期化します。架空データのみ・通知送信なし。</p></div></SmoothCollapse>
            <p className="pb-2 text-[11px] text-slate-500">画面内で保存・再読み込みで初期化・{previewConnectionLabel}</p>
          </SmoothCollapse>
          {scenario && <p className="border-t border-slate-100 py-2 text-xs leading-6 text-slate-600">{scenario}</p>}
        </section>
        {history.length > 0 && <button className="mb-3 inline-flex min-h-11 items-center gap-2 text-xs text-slate-600" onClick={back}><FontAwesomeIcon icon={faChevronLeft}/>{PAGE_NAMES[history[history.length - 1].target.page]}に戻る</button>}
        <div key={`${page}-${revision}`}>
          {page === "shifts" ? <ShiftBoard {...props} view={shiftView} setView={setShiftView}/> : <DriverBoard {...props}/>}
        </div>
      </AdminPreviewLayout>
    </PreviewNavigation.Provider>
    {notice && <div role="status" className="fixed bottom-5 left-4 right-4 z-40 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm shadow-lg md:left-auto md:right-6 md:max-w-md"><FontAwesomeIcon icon={faCheck} className="text-emerald-600"/>{notice}<button aria-label="通知を閉じる" className="ml-auto p-1 text-slate-400" onClick={() => setNotice("")}><FontAwesomeIcon icon={faXmark}/></button></div>}
    {parkingOpen && <ParkingPlacesEditor demo={demo} setDemo={setDemo} notify={setNotice} confirm={confirm} onDirtyChange={setDirty} onClose={() => { setParkingOpen(false); setDirty(false); }}/>}
    <ConfirmDialog open={!!confirmation} title={confirmation?.title} message={confirmation?.message ?? ""} confirmLabel={confirmation?.confirmLabel} onClose={() => setConfirmation(null)} onConfirm={() => { const action = confirmation?.action; setConfirmation(null); action?.(); }}/>
  </div>;
}
