import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const driverIds = [
  ['梶原','b8ebbb05-6dff-4a35-b5ba-2a4f017e87b5'],
  ['坂田','c96c534d-3106-40c4-aa90-7f1fbd95c81d'],
  ['勝政','154ba01e-fabc-4fbe-9778-899b869984fe'],
  ['島本','49340a25-5546-4c6e-833c-adbce91c0896'],
  ['日笠','93a81a10-3948-4056-b18f-14a96a5319c5'],
  ['平石','48bfee2f-cd84-4e86-9b61-b06de52c8606'],
  ['猪上','b1e7473c-d391-4ede-ba6e-00c0b4231a12'],
  ['木下','ffe3ec6e-946d-4bad-a4f8-4f22046ddbb6'],
  ['廣瀬','81d9ae34-e1a6-4f7d-8532-724df74d5fa1'],
];

const { data } = await supabase
  .from('invoice_documents')
  .select('id, month_yyyy_mm, client_name, invoice_no, amount, status, is_starred, driver_id, created_at, updated_at')
  .in('driver_id', driverIds.map(d=>d[1]))
  .eq('month_yyyy_mm', '2026-05')
  .order('created_at', { ascending: true });

console.log(`合計 ${data?.length ?? 0} 件`);
for (const [nm, id] of driverIds) {
  const mine = (data ?? []).filter(d => d.driver_id === id);
  console.log(`\n--- ${nm} (${id}) : ${mine.length}件 ---`);
  mine.forEach(m => console.log(`  id=${m.id} invoice_no=${m.invoice_no} amount=${m.amount} status=${m.status} starred=${m.is_starred} created=${m.created_at} updated=${m.updated_at}`));
}
