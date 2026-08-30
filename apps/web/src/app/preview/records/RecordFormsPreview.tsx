"use client";
import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faPlus, faGear, faFileLines, faMagnifyingGlass, faChartLine, faCalendar, faCar, faUsers, faMoneyBillWave, faLock, faChevronRight, faBars, faXmark } from "@fortawesome/free-solid-svg-icons";
import { Button } from "@/lib/ui/button";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { FormManagement } from "./FormManagement";
import { DatePicker } from "@/lib/components/DatePicker";
import { format } from "date-fns";
import FormBuilder from "./FormBuilder";
import RecordEditor from "./RecordEditor";
import { RecordListCard } from "./RecordListCard";
import { Choice, control } from "./Fields";
import { ROLE_LABELS, actorId, canConfigure, canCreate, canReadRecord, canSeeForm, displayValue, initialDemo, makeTemplate, recordTitle, type DemoRecord, type DemoRole, type FormDefinition } from "./model";

export default function RecordFormsPreview() {
  const [demo,setDemo]=useState(initialDemo);
  const [role,setRole]=useState<DemoRole>("admin");
  const [selected,setSelected]=useState("cases");
  const [mode,setMode]=useState<"records"|"forms"|"settings"|"new-form">("records");
  const [editingForm,setEditingForm]=useState<FormDefinition|null>(null);
  const [dirty,setDirty]=useState(false);
  const [pendingNavigation,setPendingNavigation]=useState<"records"|"forms"|null>(null);
  const [editor,setEditor]=useState<{record:DemoRecord|null}|null>(null);
  const [query,setQuery]=useState("");
  const [status,setStatus]=useState("");
  const [from,setFrom]=useState("");
  const [to,setTo]=useState("");
  const [notice,setNotice]=useState("");
  const [mobileNav,setMobileNav]=useState(false);
  const form=demo.forms.find(f=>f.id===selected)!;
  const visibleForms=demo.forms.filter(f=>canSeeForm(f,role));
  const permitted=demo.records.filter(r=>r.formId===form.id&&canReadRecord(form,role,r));
  const records=useMemo(()=>permitted.filter(r=>{
    const text=r.schema.fields.map(f=>displayValue(f,r.answers[f.id])).join(" ").toLocaleLowerCase();
    const date=String(r.answers[form.dateField]??"");
    return (!query||text.includes(query.toLocaleLowerCase()))&&(!status||r.status===status)&&(!from||date>=from)&&(!to||date<=to);
  }),[permitted,query,status,from,to,form.dateField]);
  const resetFilters=()=>{setQuery("");setStatus("");setFrom("");setTo("");};
  const chooseForm=(id:string)=>{setSelected(id);setEditor(null);resetFilters();setNotice("");};
  const changeRole=(next:DemoRole)=>{setRole(next);setEditor(null);setMode("records");setEditingForm(null);setDirty(false);resetFilters();setNotice("");if(!canSeeForm(form,next)){const first=demo.forms.find(f=>canSeeForm(f,next));if(first)setSelected(first.id);}};
  const allStatuses=Array.from(new Map([...form.statuses,...permitted.flatMap(r=>r.schema.statuses)].map(s=>[s.id,s])).values());
  const save=(record:DemoRecord)=>{setDemo(d=>({...d,records:d.records.some(r=>r.id===record.id)?d.records.map(r=>r.id===record.id?record:r):[record,...d.records]}));setEditor(null);setDirty(false);setNotice("このプレビュー内に保存しました");};
  const management = mode !== "records";
  const isNewForm = !!editingForm && !demo.forms.some(f => f.id === editingForm.id);
  const navigate = (destination: "records" | "forms") => {
    if (destination === "forms" && !canConfigure(role)) return;
    setMode(destination); setEditor(null); setEditingForm(null); setDirty(false);
    setNotice(""); setMobileNav(false); setPendingNavigation(null);
  };
  const requestNavigation = (destination: "records" | "forms") => {
    if (mode === destination && !editor) { setMobileNav(false); return; }
    if (dirty) { setPendingNavigation(destination); setMobileNav(false); }
    else navigate(destination);
  };
  const configure = (target: FormDefinition) => {
    if (!canConfigure(role)) return;
    setEditingForm(target); setMode("settings"); setNotice(""); setDirty(false);
  };
  const createFromTemplate = (template: "case" | "payment" | "memo") => {
    const draft = makeTemplate(template, crypto.randomUUID());
    draft.name = `${draft.name}のコピー`;
    draft.driver = { submit: false, readOwn: false, editOwn: false, readSubject: false };
    draft.access = { admin: "edit", operations: "none", accounting: "none" };
    configure(draft);
  };
  const applyForm = (next: FormDefinition) => {
    if (!canConfigure(role)) return;
    setDemo(d => ({ ...d, forms: d.forms.some(f => f.id === next.id) ? d.forms.map(f => f.id === next.id ? next : f) : [...d.forms, next] }));
    navigate("forms");
    setNotice(isNewForm ? `「${next.name}」を作成しました` : `「${next.name}」の設定を適用しました`);
  };
  const navClass = (active: boolean) => `flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 motion-reduce:transition-none ${active ? "bg-amber-100 text-amber-900" : "text-slate-600 hover:bg-slate-100"}`;
  const sidebar = <>
    <div className="flex h-20 items-center justify-between border-b border-slate-200 px-4">
      <img src="/logo/hakotora-logo_primary_logo.svg" alt="ハコ虎" className="h-16 w-auto"/>
      <button className="p-2 md:hidden" aria-label="メニューを閉じる" onClick={() => setMobileNav(false)}><FontAwesomeIcon icon={faXmark}/></button>
    </div>
    <nav className="flex-1 space-y-1 px-2 py-4" aria-label="管理メニュー">
      {[{ label: "ダッシュボード", icon: faChartLine }, { label: "シフト", icon: faCalendar }, { label: "記録・報告", icon: faFileLines }, { label: "車両", icon: faCar }, { label: "ドライバー", icon: faUsers }, { label: "収支", icon: faMoneyBillWave }].map(item => item.label === "記録・報告"
        ? <button key={item.label} className={navClass(!management)} aria-current={!management ? "page" : undefined} onClick={() => requestNavigation("records")}><FontAwesomeIcon icon={item.icon} className="w-4"/>{item.label}</button>
        : <div key={item.label} className="flex items-center gap-3 px-3 py-3 text-[13px] font-semibold text-slate-400"><FontAwesomeIcon icon={item.icon} className="w-4"/>{item.label}</div>)}
      {canConfigure(role) && <>
        <div className="px-3 pb-2 pt-7 text-[10px] font-semibold tracking-wider text-slate-400">管理者設定</div>
        <button onClick={() => requestNavigation("forms")} aria-current={management ? "page" : undefined} className={navClass(management)}><FontAwesomeIcon icon={faGear} className="w-4"/>フォーム管理</button>
      </>}
    </nav>
    <div className="border-t border-slate-200 p-4"><p className="text-sm font-semibold">サンプル組織</p><p className="mt-1 text-xs text-slate-400">{ROLE_LABELS[role]}として表示</p></div>
  </>;
  const pageTitle = mode === "forms" ? "フォーム管理" : mode === "new-form" ? "フォームを追加" : mode === "settings" && editingForm ? isNewForm ? "新しいフォームの設定" : `${editingForm.name}の設定` : "記録・報告";
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-slate-200 bg-white md:flex">{sidebar}</aside>
    {mobileNav && <div className="fixed inset-0 z-50 bg-slate-950/30" onClick={() => setMobileNav(false)}><aside className="flex h-full w-64 flex-col bg-white" onClick={e => e.stopPropagation()}>{sidebar}</aside></div>}
    <div className="md:pl-56">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3"><button aria-label="メニューを開く" className="p-2 md:hidden" onClick={() => setMobileNav(true)}><FontAwesomeIcon icon={faBars}/></button><span className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">プレビュー</span><span className="text-xs text-slate-400">架空データ · 再読み込みでリセット</span></div>
        <div className="flex items-center gap-2"><span className="text-xs text-slate-500">表示する役割</span><div className="w-40"><Choice label="表示する役割" value={role} onChange={v => changeRole(v as DemoRole)} options={Object.entries(ROLE_LABELS).map(([value,label]) => ({value,label}))} disabled={mode === "settings" || mode === "new-form" || !!editor}/></div></div>
      </div>
      <main className="mx-auto max-w-[1400px] space-y-6 p-4 pb-20 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>{management && mode !== "forms" && <p className="mb-2 text-xs text-slate-500">フォーム管理 / {mode === "new-form" || isNewForm ? "新規作成" : "設定"}</p>}<h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1></div>
          {mode === "forms" && canConfigure(role) && <Button size="touch" onClick={() => { setMode("new-form"); setNotice(""); }}><FontAwesomeIcon icon={faPlus}/>フォームを追加</Button>}
        </header>
        {notice && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
        {management && !canConfigure(role) ? <p className="text-sm text-slate-500">管理者のみ利用できます。</p>
        : mode === "forms" ? <FormManagement forms={demo.forms} onConfigure={configure}/>
        : mode === "new-form" ? <section className="space-y-5">
          <Button variant="ghost" onClick={() => navigate("forms")}><FontAwesomeIcon icon={faArrowLeft}/>フォーム一覧に戻る</Button>
          <p className="text-sm text-slate-500">ひな形を選んで、入力項目を編集します。</p>
          <div className="grid gap-4 md:grid-cols-3">{([{id:"case",title:"案件報告",text:"対象者・発生日・経緯・再発防止策"},{id:"payment",title:"日払い記録",text:"支払先・支払日・稼働日・金額・方法"},{id:"memo",title:"シンプルなメモ",text:"件名・日付・本文から作成"}] as const).map(t => <button key={t.id} className="rounded-xl border border-slate-200 bg-white p-6 text-left hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400" onClick={() => createFromTemplate(t.id)}>
            <FontAwesomeIcon icon={faFileLines} className="mb-5 size-6 text-slate-400"/><h2 className="font-semibold">{t.title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{t.text}</p><span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold">このひな形を使う<FontAwesomeIcon icon={faChevronRight} className="size-3"/></span>
          </button>)}</div>
          <p className="text-xs text-slate-500">新しいフォームは管理者だけが使える状態で作成します。</p>
        </section>
        : mode === "settings" && editingForm ? <FormBuilder key={editingForm.id} form={editingForm} isNew={isNewForm} onDirtyChange={setDirty}
            sampleRecord={demo.records.find(r => r.formId === editingForm.id)} existingCount={demo.records.filter(r => r.formId === editingForm.id).length}
            onClose={() => navigate("forms")} onApply={applyForm}/>
        : editor ? <RecordEditor key={editor.record?.id ?? "new"} form={form} record={editor.record} role={role} onDirtyChange={setDirty} onSave={save} onClose={() => { setEditor(null); setDirty(false); }}/>
        :<><div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist" aria-label="記録の種類">{visibleForms.map(f=><button role="tab" aria-selected={f.id===selected} key={f.id} onClick={()=>chooseForm(f.id)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${f.id===selected?"border-slate-900 text-slate-900":"border-transparent text-slate-500 hover:text-slate-900"}`}>{f.name}<span className="ml-2 text-xs text-slate-400">{demo.records.filter(r=>r.formId===f.id&&canReadRecord(f,role,r)).length}</span></button>)}</div>
          {!visibleForms.length||!canSeeForm(form,role)?<p className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">この役割で使えるフォームはありません。</p>:<><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><h2 className="text-lg font-semibold">{form.name}の一覧</h2>{form.category&&<span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-500">{form.category}</span>}</div><div className="flex gap-2">{canCreate(form,role)&&<Button size="touch" onClick={()=>{setEditor({record:null});setNotice("");}}><FontAwesomeIcon icon={faPlus}/>{role==="driver"?"報告する":"記録を追加"}</Button>}</div></div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><div className="relative min-w-[180px] flex-1"><FontAwesomeIcon icon={faMagnifyingGlass} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input className={`${control} !pl-10`} aria-label="記録を検索" placeholder="記録を検索" value={query} onChange={e=>setQuery(e.target.value)}/></div>{allStatuses.length>0&&<div className="w-40"><Choice label="対応状況で絞り込み" value={status} onChange={setStatus} options={[{value:"",label:"すべて"},...allStatuses.map(s=>({value:s.id,label:s.label}))]}/></div>}{form.dateField&&<div className="flex w-full items-center gap-2 sm:w-auto"><DatePicker ariaLabel="開始日" placeholder="開始日" displayFormat="yyyy/MM/dd" className="h-11 min-w-0 flex-1 rounded-lg sm:w-36 sm:flex-none" value={from?new Date(`${from}T00:00:00`):undefined} toDate={to?new Date(`${to}T00:00:00`):undefined} onChange={d=>setFrom(d?format(d,"yyyy-MM-dd"):"")}/><span className="text-slate-400">〜</span><DatePicker ariaLabel="終了日" placeholder="終了日" displayFormat="yyyy/MM/dd" className="h-11 min-w-0 flex-1 rounded-lg sm:w-36 sm:flex-none" value={to?new Date(`${to}T00:00:00`):undefined} fromDate={from?new Date(`${from}T00:00:00`):undefined} onChange={d=>setTo(d?format(d,"yyyy-MM-dd"):"")}/></div>}{(query||status||from||to)&&<Button variant="ghost" onClick={resetFilters}>クリア</Button>}</div>
          <div className="flex items-center justify-between text-xs text-slate-500"><span>{records.length}件</span><span>{role==="driver"?"本人への公開設定に基づく表示":form.access[role]==="view"?"閲覧のみ":""}</span></div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">{records.length===0?<p className="p-8 text-center text-sm text-slate-500">該当する記録はありません</p>:records.map(r=><RecordListCard key={r.id} title={recordTitle(r)}
            items={form.fields.filter(f=>f.inList&&f.id!==form.titleField).map(f=>({id:f.id,label:f.label,value:displayValue(r.schema.fields.find(x=>x.id===f.id)??f,r.answers[f.id])}))}
            status={r.status ? r.schema.statuses.find(s=>s.id===r.status) ?? {label:r.status,terminal:false} : undefined}
            onOpen={()=>{setEditor({record:r});setNotice("");}}/>)}</div>
          <p className="flex items-center gap-2 text-xs text-slate-400"><FontAwesomeIcon icon={faLock}/>{role==="driver"?`サンプルの佐藤として確認中（${actorId(role)}）`:"このプレビューでは業務データに連携しません"}</p>
        </>}</>}
      </main>
    </div>
    <ConfirmDialog open={!!pendingNavigation} title="変更を破棄して移動しますか？" message="保存していない入力や設定は失われます。" confirmLabel="破棄して移動" onClose={() => setPendingNavigation(null)} onConfirm={() => { if (pendingNavigation) navigate(pendingNavigation); }}/>
  </div>;
}
