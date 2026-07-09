import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const floorEx = (v) => Math.floor(v / 1.1);

// --- 1. 固定単価コース(Amazon等) ---
const FIXED_COURSE_IDS = [
  '0fff17ec-5077-4281-ad7d-87dcb7326ef5', // Amazonミッドナイト
  'c48d1974-cf1a-4f67-b8c6-5444a1235ea8', // Amazon　昼
  '2a6dca0c-09f4-485a-bfc5-da5e8cd3cdfb', // Amazon昼（リース代抜き）
  'f92cbfbf-171f-43d4-bfe4-11b44ba2a5f9', // Amazon半日（リース代抜き）
  'fac5f9b2-95da-4309-9301-e037ad098f41', // Amazonミッドナイトリース代（fiants）
  'd6f8b619-d3eb-41d3-9cc5-c84254607f5f', // 上賀茂（リース代抜き）
  'c5914b80-92bd-4963-bc60-db2105ea107c', // 下京ヤマト日当
  '3e9dcd74-ac96-4688-b8fd-6bc94c96efb9', // 豊中Amazon昼（リース代抜き）
];
const { data: fixedRates, error: fixedRatesErr } = await supabase.from('course_fixed_rates').select('course_id, fixed_payout').in('course_id', FIXED_COURSE_IDS);
if (fixedRatesErr) { console.error(fixedRatesErr); process.exit(1); }
console.log('=== course_fixed_rates 更新 ===');
for (const r of fixedRates) {
  const newVal = floorEx(r.fixed_payout);
  const { error } = await supabase.from('course_fixed_rates').update({ fixed_payout: newVal, updated_at: new Date().toISOString() }).eq('course_id', r.course_id);
  console.log(`  ${r.course_id}: ${r.fixed_payout} -> ${newVal} ${error ? 'ERROR:'+error.message : 'OK'}`);
}
const { data: coursesToFlip } = await supabase.from('courses').select('id, payout_tax_basis').in('id', FIXED_COURSE_IDS);
for (const c of coursesToFlip) {
  const { error } = await supabase.from('courses').update({ payout_tax_basis: 'inclusive' }).eq('id', c.id);
  console.log(`  course ${c.id} payout_tax_basis: ${c.payout_tax_basis} -> inclusive ${error ? 'ERROR:'+error.message : 'OK'}`);
}

// --- 2. driver_fixed_expenses ---
const FIXED_EXP_IDS = [
  '1043f9b3-2c1b-4360-a91f-b97137534112','47958a91-2ba8-44eb-b9b2-5dc9e1c6c894','1bb9fdf1-efef-4822-b72f-2330d9ef1484',
  '4bf01d84-f069-4fe1-8917-b1917378b7b3','6f21eaf1-e9bb-40ec-b3af-08f6e48239f6','75317221-9fc4-4877-9a8e-e8e40631465b',
  'c0ee2216-f126-464e-a012-db8ffe2d5729','5bcaee7e-f68f-4ee4-8a26-b8b618507572','89056fe9-0dd2-426b-b6ea-50989172ec49',
  'e4e91e93-8b5c-4240-8493-872d8f9dd228','402479a3-791a-4ad9-87ac-7134adea3a4a','2be91e65-f00f-46ba-8751-a438b705f919',
  'eec1a98a-ccdd-44ec-bea8-a5b75eb211ed','b702670c-9077-49ee-956e-60bfc078c9a3',
];
const { data: fixedExp } = await supabase.from('driver_fixed_expenses').select('id, amount').in('id', FIXED_EXP_IDS);
console.log('\n=== driver_fixed_expenses 更新 ===');
for (const r of fixedExp) {
  const newVal = floorEx(r.amount);
  const { error } = await supabase.from('driver_fixed_expenses').update({ amount: newVal, updated_at: new Date().toISOString() }).eq('id', r.id);
  console.log(`  ${r.id}: ${r.amount} -> ${newVal} ${error ? 'ERROR:'+error.message : 'OK'}`);
}

// --- 3. driver_ad_hoc_expenses (正の値=控除のみ対象。手当(負)は対象外) ---
const AD_HOC_IDS_POSITIVE = [
  '191b0f66-183a-4e46-82a8-bffbab36a0fc', // ブレーキ交換 39500
  '63ce3cd3-6f10-45b9-951a-e671a810b07b', // タイヤ交換 15400
  'd9a3bc1e-4825-45d9-a976-0caea775af4b', // タイヤ交換 19700
  '531ae893-0de8-40cc-9301-b71306a7bc2a', // オイル交換 4060
];
const { data: adHoc } = await supabase.from('driver_ad_hoc_expenses').select('id, amount').in('id', AD_HOC_IDS_POSITIVE);
console.log('\n=== driver_ad_hoc_expenses 更新(控除のみ) ===');
for (const r of adHoc) {
  const newVal = floorEx(r.amount);
  const { error } = await supabase.from('driver_ad_hoc_expenses').update({ amount: newVal, updated_at: new Date().toISOString() }).eq('id', r.id);
  console.log(`  ${r.id}: ${r.amount} -> ${newVal} ${error ? 'ERROR:'+error.message : 'OK'}`);
}
console.log('\n完了');
