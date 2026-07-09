import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const ids = [
  '5c38127a-9757-4ff6-a1da-cc227ea211e5', // 梶原
  'fe6e3e39-9bd1-4f76-bfe8-80c9f51317e2', // 坂田
  '8b7cbdc4-da64-40d0-a30b-10d2e05a5012', // 勝政 R01 approved
  'edc42d72-6775-4556-ba11-710bc3cda39b', // 勝政 R02 draft
  '73417494-2859-4df3-bc7e-11dcb4834a70', // 島本
  '6259ad5e-fdac-4de4-9b1b-14b04c197da0', // 日笠 R00
  '1558bd74-c4ea-4fa0-9e08-246939f70f48', // 日笠 R01 draft
  'e217462e-f582-46ff-b9ae-96cef49d6c50', // 平石 (Apr??)
  '799a08c7-94cb-445c-9cd6-1457aa168927', // 木下
  '4444b647-b9f8-46be-a271-a242873b7522', // 廣瀬
];
const { data } = await supabase.from('invoice_documents').select('id, invoice_no, status, amount, month_yyyy_mm, payload').in('id', ids);
const byId = new Map(data.map(d=>[d.id,d]));
for (const id of ids) {
  const d = byId.get(id);
  console.log(`\n########## ${d.invoice_no} status=${d.status} amount=${d.amount} month=${d.month_yyyy_mm} ##########`);
  console.log('main:', JSON.stringify(d.payload?.tableData?.main));
  console.log('deduct:', JSON.stringify(d.payload?.tableData?.deduct));
  console.log('loanRepay:', d.payload?.loanRepay, 'extraOutsourcingExclusive:', d.payload?.extraOutsourcingExclusive, 'displayBasis:', d.payload?.displayBasis);
}
