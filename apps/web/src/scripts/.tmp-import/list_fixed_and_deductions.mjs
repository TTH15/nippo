import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const driverIds = [
  'b8ebbb05-6dff-4a35-b5ba-2a4f017e87b5','c96c534d-3106-40c4-aa90-7f1fbd95c81d','154ba01e-fabc-4fbe-9778-899b869984fe',
  '49340a25-5546-4c6e-833c-adbce91c0896','93a81a10-3948-4056-b18f-14a96a5319c5','48bfee2f-cd84-4e86-9b61-b06de52c8606',
  'b1e7473c-d391-4ede-ba6e-00c0b4231a12','ffe3ec6e-946d-4bad-a4f8-4f22046ddbb6','81d9ae34-e1a6-4f7d-8532-724df74d5fa1',
];
const START='2026-05-01', END='2026-05-31', MONTH='2026-05';

const { data: reports } = await supabase.from('daily_reports_v2').select('id, driver_id, course_id, rejected_at').in('driver_id', driverIds).gte('report_date', START).lte('report_date', END);
const countable = (reports??[]).filter(r=>!r.rejected_at);
const courseIds = [...new Set(countable.map(r=>r.course_id).filter(Boolean))];
const { data: fixedRates } = await supabase.from('course_fixed_rates').select('course_id, fixed_payout').in('course_id', courseIds).gt('fixed_payout', 0);
const { data: courses } = await supabase.from('courses').select('id, name, payout_tax_basis').in('id', fixedRates.map(f=>f.course_id));
const courseById = new Map(courses.map(c=>[c.id,c]));
console.log('=== 固定単価コース(fixed_payout>0) ===');
for (const f of fixedRates) {
  const c = courseById.get(f.course_id);
  console.log(`  ${c.name} (${f.course_id}): fixed_payout=${f.fixed_payout} payout_tax_basis=${c.payout_tax_basis} -> floor=${Math.floor(f.fixed_payout/1.1)}`);
}

const { data: fixedExp } = await supabase.from('driver_fixed_expenses').select('id, driver_id, name, amount, valid_from, valid_to').in('driver_id', driverIds).lte('valid_from', END).or(`valid_to.is.null,valid_to.gte.${START}`);
console.log('\n=== driver_fixed_expenses ===');
for (const e of fixedExp) console.log(`  id=${e.id} driver=${e.driver_id} ${e.name}: ${e.amount} -> floor=${Math.floor(e.amount/1.1)}`);

const { data: adHoc } = await supabase.from('driver_ad_hoc_expenses').select('id, driver_id, name, amount, month').in('driver_id', driverIds).eq('month', MONTH);
console.log('\n=== driver_ad_hoc_expenses ===');
for (const e of adHoc) console.log(`  id=${e.id} driver=${e.driver_id} ${e.name}: ${e.amount} ${e.amount>0 ? '-> floor='+Math.floor(e.amount/1.1) : '(手当・対象外のまま)'}`);

const { data: leases } = await supabase.from('driver_leases').select('id, driver_id, mode, amount').in('driver_id', driverIds);
console.log('\n=== driver_leases ===');
console.log(leases.length ? leases : '  (該当なし)');
