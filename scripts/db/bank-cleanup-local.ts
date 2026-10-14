/** 今回だけのローカル確認・更新。127.0.0.1にだけ待受け、本番Webには含めない。 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { saveReviewedBank } from "./bank-cleanup-local-apply";
import { bankCleanupRow, bankStorageFields, type BankCleanupDriver } from "../../apps/web/src/lib/bankCleanup";
import { bankAccountFromStorage, bankAccountFormValues, bankAccountTypeLabels } from "../../apps/web/src/lib/bankAccount";
const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
for (const name of ["--input", "--out-dir", "--env-file"]) if (!process.argv.includes(name)) throw Error(`${name} が必要です`);
dotenv.config({ path: arg("--env-file"), quiet: true });
const expectedHost = "ooirajiizydcynyglvuv.supabase.co";
if (new URL(process.env.SUPABASE_URL!).hostname !== expectedHost) throw Error("対象プロジェクトが違います");
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const drivers = JSON.parse(fs.readFileSync(arg("--input"), "utf8")) as (BankCleanupDriver & { org_id: string })[];
const orgId = "1314c7a1-0f86-44fd-8f60-01588735295a";
if (drivers.some(row => row.org_id !== orgId)) throw Error("対象会社が違います");
const columns = bankStorageFields.filter(key => drivers.every(row => Object.hasOwn(row, key)));
const dir = path.resolve(arg("--out-dir")); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const token = crypto.randomBytes(32).toString("hex");
const checked = new Set<string>(process.argv.includes("--selection") ? JSON.parse(fs.readFileSync(arg("--selection"), "utf8")) : []);
const done = new Set<string>(); let applying = false;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const rows = drivers.map(driver => {
 const cleanup = bankCleanupRow(driver); if (!cleanup) return null;
 const form = bankAccountFormValues(bankAccountFromStorage(driver));
 const editable = cleanup.candidate ?? { bank_name: form.bankName, bank_branch_name: form.bankBranch ?? "", bank_account_type: form.bankType || null, bank_account_type_other: form.bankTypeOther ?? null, bank_no: form.bankNo, bank_holder: driver.bank_holder };
 const blocked = !/^\d{1,8}$/.test(editable.bank_no ?? "") || editable.bank_account_type === "other" && !columns.includes("bank_account_type_other") || cleanup.reason.includes("一致しません");
 return { driver, editable, reason: cleanup.reason, blocked };
}).filter(row => row !== null);
function render() {
 const labels = { bank_name: "銀行名", bank_branch_name: "支店名", bank_account_type: "口座種別", bank_no: "口座番号", bank_holder: "口座名義" };
 return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'"><title>今回の口座整理</title><style>body{font:14px system-ui;background:#f8fafc;color:#0f172a;margin:24px auto;padding:0 20px;max-width:1100px}h1{font-size:22px}section{background:white;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:16px 0}header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}table{width:100%;border-collapse:collapse;margin-top:12px;table-layout:fixed}th,td{text-align:left;padding:10px;border-bottom:1px solid #e2e8f0;overflow-wrap:anywhere}th:first-child{width:80px}th{color:#64748b}input[type=text]{box-sizing:border-box;width:100%;height:48px;padding:8px;border:1px solid #cbd5e1;border-radius:4px;font:inherit}label{display:flex;align-items:center;gap:8px;min-height:44px}input[type=checkbox]{width:20px;height:20px}button{background:#0f172a;color:white;border:0;border-radius:8px;padding:12px 20px;font:inherit;min-height:44px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.warning,.error{color:#b45309}.saved{color:#15803d}.bar{position:sticky;top:0;background:#f8fafc;padding:12px 0;border-bottom:1px solid #e2e8f0;z-index:1}@media(max-width:500px){body{padding:0 12px}section{padding:12px}td,th{padding:8px 4px;font-size:12px}th:first-child{width:48px}}</style><h1>今回の口座整理</h1><p>銀行名・支店名を書き直し、確認済みにした行を本番へ反映します。</p><div class="bar"><button id="apply" disabled>確認した0件を更新</button><p id="status" role="status"></p></div>${rows.map(row => `<section data-id="${escape(row.driver.id)}"><header><strong>${escape(row.driver.name)} ${escape(row.driver.driver_code)}</strong>${done.has(row.driver.id) ? '<span class="saved">更新済み</span>' : row.blocked ? '<span class="warning">手動確認が必要</span>' : `<label><input type="checkbox" ${checked.has(row.driver.id)?'checked':''}>確認済み</label>`}</header>${row.reason ? `<p class="warning">${escape(row.blocked ? row.editable.bank_account_type === "other" ? "その他の具体名は本番が未対応のため、この画面からは更新できません" : row.reason : row.reason + "。右の欄を修正してください")}</p>` : ""}<table><thead><tr><th>項目</th><th>元の値</th><th>更新内容</th></tr></thead><tbody>${Object.entries(labels).map(([key,label])=>{const k=key as keyof typeof labels;const old=row.driver[k];const value=row.editable[k];return `<tr><td>${label}</td><td>${escape(k==='bank_account_type' ? bankAccountTypeLabels[old as keyof typeof bankAccountTypeLabels]??old??'—' : old??'—')}</td><td>${(k==='bank_name'||k==='bank_branch_name') && !row.blocked && !done.has(row.driver.id) ? `<input type="text" data-key="${k}" aria-label="${escape(row.driver.name+'の'+label)}" value="${escape(value)}">` : escape(k==='bank_account_type' ? bankAccountTypeLabels[value as keyof typeof bankAccountTypeLabels]??value??'—' : value??'—')}</td></tr>`}).join('')}</tbody></table><p class="result" role="status"></p></section>`).join('')}<script>const button=document.querySelector('#apply');const checks=()=>[...document.querySelectorAll('input[type=checkbox]:checked')];const update=()=>{button.textContent='確認した'+checks().length+'件を更新';button.disabled=!checks().length};update();document.addEventListener('change',update);document.addEventListener('input',e=>{const box=e.target.closest('section')?.querySelector('input[type=checkbox]');if(box){box.checked=false;update()}});button.onclick=async()=>{const selected=checks().map(e=>{const section=e.closest('section');return {id:section.dataset.id,bankName:section.querySelector('[data-key=bank_name]').value,bankBranch:section.querySelector('[data-key=bank_branch_name]').value}});button.disabled=true;document.querySelector('#status').textContent='更新中…';document.querySelectorAll('input').forEach(e=>e.disabled=true);try{const response=await fetch('/apply',{method:'POST',headers:{'Content-Type':'application/json','X-Review-Token':'${token}'},body:JSON.stringify({rows:selected})});const data=await response.json();if(!response.ok)throw Error(data.error);for(const result of data.results){const section=[...document.querySelectorAll('section')].find(e=>e.dataset.id===result.id);section.querySelector('.result').textContent=result.ok?'更新しました':result.error;section.querySelector('.result').className='result '+(result.ok?'saved':'error');if(result.ok){section.dataset.done='true';const box=section.querySelector('input[type=checkbox]');box.checked=false;}}document.querySelector('#status').textContent=data.results.filter(e=>e.ok).length+'件を更新しました';}catch(e){document.querySelector('#status').textContent=e.message;}finally{document.querySelectorAll('input').forEach(e=>e.disabled=e.closest('section').dataset.done==='true');update();}};</script></html>`;
}
async function start() {
 const probe = await db.from("drivers").select("id").eq("org_id",orgId).limit(1);
 if(probe.error)throw Error("本番DBの読み取り接続を確認できませんでした");
 const server = http.createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(render());return;}
  const reply=(status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(req.method!=='POST'||req.url!=='/apply'){reply(404,{error:'対象外です'});return;}
  if(req.headers['x-review-token']!==token||req.headers.origin!=='http://127.0.0.1:3252'){reply(403,{error:'確認画面を開き直してください'});return;}
  if(applying){reply(409,{error:'更新中です'});return;}
  applying=true;
  try {
   let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)throw Error('確認対象が多すぎます');}
   const selected=JSON.parse(text).rows;
   if(!Array.isArray(selected)||!selected.length||selected.length>rows.length||new Set(selected.map(v=>v.id)).size!==selected.length)throw Error('確認した行を選んでください');
   const prepared=selected.map(v=>{const row=rows.find(row=>row.driver.id===v.id);if(!row||row.blocked||done.has(v.id))throw Error('更新できない対象が含まれています');if(typeof v.bankName!=='string'||!v.bankName.trim()||v.bankName.length>100||typeof v.bankBranch!=='string'||!v.bankBranch.trim()||v.bankBranch.length>100)throw Error('銀行名と支店名を入力してください');return {row,candidate:{...row.editable,bank_name:v.bankName.trim(),bank_branch_name:v.bankBranch.trim()}};});
   const audit=path.join(dir,`reviewed-${Date.now()}.json`);fs.writeFileSync(audit,JSON.stringify(prepared,null,2),{mode:0o600});
   const results=[];
   for(const item of prepared){const {row,candidate}=item;const result=await saveReviewedBank(db,orgId,row.driver,candidate,columns);if(result.ok)done.add(row.driver.id);results.push(result);}
   fs.writeFileSync(audit+'.result.json',JSON.stringify(results,null,2),{mode:0o600});reply(200,{results});
  }catch{reply(400,{error:'確認内容を保存できませんでした。銀行名・支店名と対象行を確認してください'});}finally{applying=false;}
 });server.on('error',()=>{console.error('ローカル確認画面を起動できませんでした');process.exitCode=1;});server.listen(3252,'127.0.0.1',()=>console.log('Local review ready: http://127.0.0.1:3252/ (no updates yet)'));
}
start().catch(()=>{console.error('接続または起動を確認できませんでした。本番データは更新していません。');process.exitCode=1;});
