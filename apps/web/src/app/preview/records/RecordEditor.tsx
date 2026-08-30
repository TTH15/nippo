"use client";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faPen, faLock, faPlus } from "@fortawesome/free-solid-svg-icons";
import { Button } from "@/lib/ui/button";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { todayJST } from "@/lib/date";
import { FieldControl, Choice, control } from "./Fields";
import { MEMBERS, actorId, canEditRecord, displayValue, recordTitle, validateAnswers, type AnswerMap, type DemoRecord, type DemoRole, type FormDefinition } from "./model";
export default function RecordEditor({form,record,role,onSave,onClose,onDirtyChange}: {form:FormDefinition;record:DemoRecord|null;role:DemoRole;onSave:(record:DemoRecord)=>void;onClose:()=>void;onDirtyChange?:(dirty:boolean)=>void}) {
  const schema=record?.schema??form;
  const [answers,setAnswers]=useState<AnswerMap>(()=>record?.answers??{...(schema.dateField?{[schema.dateField]:todayJST()}:{}),...(role==="driver"&&schema.subjectField?{[schema.subjectField]:actorId(role)}:{})});
  const [status,setStatus]=useState(record?.status??schema.statuses[0]?.id??"");
  const [editing,setEditing]=useState(!record);
  const [proxy,setProxy]=useState(!!record&&record.reporter!==record.author);
  const [reporter,setReporter]=useState(record?.reporter??actorId(role));
  const [note,setNote]=useState("");
  const [internalNote,setInternalNote]=useState("");
  const [error,setError]=useState("");
  const [confirmLeave,setConfirmLeave]=useState(false);
  const needsLeaveConfirmation=editing||!!internalNote.trim();
  useEffect(()=>{onDirtyChange?.(needsLeaveConfirmation);},[needsLeaveConfirmation,onDirtyChange]);
  const editable=!record||canEditRecord(form,role,record);
  const actorName=(id:string)=>MEMBERS.find(m=>m.value===id)?.label??id;
  const save=()=>{const message=validateAnswers(schema,answers);if(message){setError(message);return;}if(record&&!note.trim()){setError("変更内容・追記を入力してください");return;}const now=new Date().toISOString();onSave({id:record?.id??crypto.randomUUID(),formId:form.id,schema:structuredClone(schema),answers:structuredClone(answers),status,author:record?.author??actorId(role),reporter:proxy?reporter:record?.author??actorId(role),createdAt:record?.createdAt??now,history:record?[...record.history,{at:now,by:actorId(role),text:note.trim(),internal:false}]:[]});};
  return <section className="mx-auto max-w-4xl space-y-5"><div className="flex items-center justify-between gap-3"><Button variant="ghost" onClick={()=>needsLeaveConfirmation?setConfirmLeave(true):onClose()}><FontAwesomeIcon icon={faArrowLeft}/>{form.name}の一覧に戻る</Button>{record&&editable&&!editing&&<Button variant="outline" onClick={()=>setEditing(true)}><FontAwesomeIcon icon={faPen}/>編集・追記</Button>}</div>
    <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"><div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><p className="mb-1 text-xs text-slate-500">{schema.name} · v{schema.version}</p><h2 className="text-xl font-bold text-slate-900">{record?recordTitle(record):"新しい記録"}</h2></div>{record&&schema.statuses.length>0&&<span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{schema.statuses.find(s=>s.id===record.status)?.label??record.status}</span>}</div>
      {editing?<form onSubmit={e=>{e.preventDefault();save();}} className="space-y-6"><div className="grid grid-cols-1 gap-6 [&>div]:!col-span-1">{schema.fields.map(f=><FieldControl key={f.id} field={f} value={answers[f.id]} onChange={v=>setAnswers(a=>({...a,[f.id]:v}))}/>)}</div>
        {role!=="driver"&&schema.statuses.length>0&&<div className="max-w-xs space-y-2"><p className="text-xs font-semibold text-slate-600">対応状況</p><Choice label="対応状況" value={status} options={schema.statuses.map(s=>({value:s.id,label:s.label}))} onChange={setStatus}/></div>}
        <div className="space-y-3 border-t border-slate-100 pt-4"><p className="text-xs text-slate-500">記入者：{actorName(record?.author??actorId(role))}（自動記録）</p>{role!=="driver"&&<><CheckboxField label="別の人からの報告を代理入力" checked={proxy} onCheckedChange={setProxy} aria-controls="proxy-reporter" aria-expanded={proxy} className="w-fit"/><SmoothCollapse open={proxy} id="proxy-reporter"><div className="max-w-xs"><Choice label="報告者" value={reporter} options={MEMBERS} onChange={setReporter}/></div></SmoothCollapse></>}</div>
        {record&&<label className="block text-xs font-semibold text-slate-600">変更内容・追記<textarea className={`${control} mt-2`} rows={3} required value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label>}
        {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}<Button type="submit" size="touch">{record?"変更を保存":"記録を追加"}</Button>
      </form>:<><dl className="grid gap-5 sm:grid-cols-2">{schema.fields.map(f=><div key={f.id} className={f.type==="long_text"?"sm:col-span-2":""}><dt className="text-xs font-semibold text-slate-500">{f.label}</dt><dd className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-900">{displayValue(f,record!.answers[f.id])}</dd></div>)}</dl><p className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">記入者：{actorName(record!.author)}{record!.reporter!==record!.author?` · 報告者：${actorName(record!.reporter)}`:""} · {new Date(record!.createdAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}</p></>}
    </div>
    {record&&!editing&&<section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"><h3 className="font-semibold text-slate-900">対応・追記</h3>{record.history.filter(h=>role!=="driver"||!h.internal).length===0?<p className="text-sm text-slate-400">追記はありません</p>:record.history.filter(h=>role!=="driver"||!h.internal).map((h,i)=><div key={i} className="border-l-2 border-slate-200 pl-4"><p className="mb-2 text-xs text-slate-400">{actorName(h.by)} · {new Date(h.at).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}{h.internal&&<span className="ml-2 text-slate-600"><FontAwesomeIcon icon={faLock} className="mr-1"/>運営専用</span>}</p><p className="whitespace-pre-wrap text-sm text-slate-700">{h.text}</p></div>)}{role!=="driver"&&editable&&<div className="space-y-3 border-t border-slate-100 pt-4"><label className="block text-xs font-semibold text-slate-600">運営専用の追記<textarea className={`${control} mt-2`} value={internalNote} onChange={e=>setInternalNote(e.target.value)} rows={3} maxLength={2000}/></label><Button variant="outline" disabled={!internalNote.trim()} onClick={()=>onSave({...record,history:[...record.history,{at:new Date().toISOString(),by:actorId(role),text:internalNote.trim(),internal:true}]})}><FontAwesomeIcon icon={faPlus}/>追記する</Button></div>}</section>}
    <ConfirmDialog open={confirmLeave} title="入力を破棄しますか？" message="この入力画面で保存していない内容は失われます。" confirmLabel="破棄して戻る" onClose={()=>setConfirmLeave(false)} onConfirm={onClose}/>
  </section>;
}
