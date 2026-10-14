/** 一度だけ使う口座整理。読み取り済みJSONから比較画面・計画を作る。DBへは接続しない。 */
import fs from "node:fs";
import path from "node:path";
import { bankCleanupRow, bankStorageFields, type BankCleanupDriver } from "../../apps/web/src/lib/bankCleanup";
const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes("--input") || !process.argv.includes("--out-dir")) throw Error("--input <読取JSON> --out-dir <ローカル保存先> が必要です");
const rows = JSON.parse(fs.readFileSync(arg("--input"), "utf8")) as (BankCleanupDriver & { org_id: string })[];
if (!Array.isArray(rows) || rows.some(row => !row.id || !row.org_id)) throw Error("id/org_id付きの口座データが必要です");
const columns = bankStorageFields.filter(key => rows.every(row => Object.hasOwn(row, key)));
const plan = rows.map(bankCleanupRow).filter(row => !!row).map(row => {
 if (row.candidate?.bank_account_type === "other" && !columns.includes("bank_account_type_other")) return { ...row, candidate: null, reason: "その他の保存項目は本番未対応" };
 return row;
});
const dir = path.resolve(arg("--out-dir")); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const write = (file: string, text: string) => { fs.writeFileSync(path.join(dir, file), text, { mode: 0o600 }); fs.chmodSync(path.join(dir, file), 0o600); };
write("plan.json", JSON.stringify({ columns, rows: plan }, null, 2));
const escape = (v: unknown) => String(v ?? "—").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const labels = { bank_name: "銀行名", bank_branch_name: "支店名", bank_account_type: "口座種別", bank_account_type_other: "種別名", bank_no: "口座番号", bank_holder: "口座名義" };
const types: Record<string, string> = { ordinary: "普通", current: "当座", savings: "貯蓄", other: "その他" };
write("review.html", `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'; connect-src 'none'"><title>今回の口座整理</title><style>body{font:14px system-ui;background:#f8fafc;color:#0f172a;margin:24px auto;padding:0 20px;max-width:1100px}h1{font-size:22px}section{background:white;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:16px 0}header{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:left;padding:10px;border-bottom:1px solid #e2e8f0;overflow-wrap:anywhere}td:first-child{width:90px;color:#64748b}th{font-weight:600;color:#64748b}label{display:flex;align-items:center;gap:8px;min-height:44px}input{width:20px;height:20px}button{background:#0f172a;color:white;border:0;border-radius:8px;padding:12px 20px;font:inherit;min-height:44px;cursor:pointer}.warning{color:#b45309}@media(max-width:500px){body{padding:0 12px}section{padding:12px}td,th{padding:8px 4px;font-size:12px}}</style><h1>今回の口座整理</h1><p>元の値と候補を確認し、更新する行にチェックしてください。ここではデータは更新されません。</p><button id="export">確認した行の一覧を保存</button><p id="count">0件選択</p>${plan.map(row => `<section><header><strong>${escape(row.driver.name)} ${escape(row.driver.driver_code)}</strong>${row.candidate ? `<label><input type="checkbox" value="${escape(row.driver.id)}">確認済み</label>` : `<span class="warning">${escape(row.reason)}</span>`}</header><table><thead><tr><th>項目</th><th>元の値</th><th>更新候補</th></tr></thead><tbody>${bankStorageFields.map(key => `<tr><td>${labels[key]}</td><td>${escape(key === "bank_account_type" ? types[row.driver[key] ?? ""] ?? row.driver[key] : row.driver[key])}</td><td>${row.candidate ? escape(key === "bank_account_type" ? types[row.candidate[key] ?? ""] ?? row.candidate[key] : row.candidate[key]) : "—"}</td></tr>`).join("")}</tbody></table></section>`).join("")}<script>const ids=()=>[...document.querySelectorAll('input:checked')].map(e=>e.value);document.addEventListener('change',()=>document.querySelector('#count').textContent=ids().length+'件選択');document.querySelector('#export').onclick=()=>{if(!ids().length)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(ids(),null,2)],{type:'application/json'}));a.download='approved-bank-cleanup.json';a.click();URL.revokeObjectURL(a.href)};</script></html>`);
if (process.argv.includes("--approved")) {
 const approved: unknown = JSON.parse(fs.readFileSync(arg("--approved"), "utf8"));
 if (!Array.isArray(approved) || !approved.length || approved.some(id => typeof id !== "string") || new Set(approved).size !== approved.length) throw Error("確認済みIDの配列が必要です");
 const selected = approved.map(id => { const row = plan.find(row => row.driver.id === id); if (!row?.candidate) throw Error("確認済みIDに更新候補がありません"); return row; });
 const sqlValue = (value: unknown) => value == null ? "NULL" : `'${String(value).replace(/'/g,"''")}'`;
 const sql = (reverse: boolean) => `BEGIN;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='30s';\n` + selected.map(row => {
  const before = reverse ? row.candidate! : row.driver; const after = reverse ? row.driver : row.candidate!;
  const where = [`id=${sqlValue(row.driver.id)}`, `org_id=${sqlValue((row.driver as typeof rows[number]).org_id)}`, "works_as_driver=true", ...columns.map(key => `${key} IS NOT DISTINCT FROM ${sqlValue(before[key])}`)].join(" AND ");
  const block = `BEGIN UPDATE public.drivers SET ${columns.map(key => `${key}=${sqlValue(after[key])}`).join(",")} WHERE ${where}; IF NOT FOUND THEN RAISE EXCEPTION '口座が変更済み、対象外、または整理済みです'; END IF; END`;
  let tag = "$bank_cleanup_guard$"; while (block.includes(tag)) tag = tag.slice(0, -1) + "_$";
  return `DO ${tag} ${block} ${tag};`;
 }).join("\n") + "\nCOMMIT;\n";
 write("apply-reviewed.sql", sql(false)); write("rollback-reviewed.sql", sql(true));
}
console.log(JSON.stringify({ read: rows.length, candidates: plan.filter(row => row.candidate).length, manual: plan.filter(row => !row.candidate).length, output: dir, databaseUpdated: false }));
