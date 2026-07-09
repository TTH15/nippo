import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const floorEx = (v) => Math.floor(v / 1.1);

const TARGET_COURSES = ['ヤマト上京', 'ヤマト山城', 'ヤマト一乗寺', 'ヤマト宇治田原', 'ヤマト下京'];
const { data: courses } = await supabase.from('courses').select('id, name, payout_tax_basis').in('name', TARGET_COURSES);
const { data: units } = await supabase.from('units').select('id, name');
const unitName = new Map(units.map(u => [u.id, u.name]));
const courseById = new Map(courses.map(c => [c.id, c]));

const { data: rates } = await supabase.from('course_unit_rates').select('id, course_id, unit_id, payout_per_unit').in('course_id', courses.map(c => c.id));

console.log('=== 適用前後 (payout側のみ) ===');
for (const r of rates) {
  const course = courseById.get(r.course_id);
  const uname = unitName.get(r.unit_id);
  // 下京の宅急便(161円)は元々税抜のまま(端数あり=修正対象外)、ネコポス(30円)のみ対象
  const isTargetLine = !(course.name === 'ヤマト下京' && uname === '宅急便');
  if (!isTargetLine) {
    console.log(`  [スキップ] ${course.name} / ${uname}: ${r.payout_per_unit}円 (端数ありのため対象外)`);
    continue;
  }
  const newVal = floorEx(r.payout_per_unit);
  console.log(`  ${course.name} / ${uname}: ${r.payout_per_unit}円 -> ${newVal}円`);
  const { error } = await supabase.from('course_unit_rates').update({ payout_per_unit: newVal, updated_at: new Date().toISOString() }).eq('id', r.id);
  if (error) console.error('  ERROR updating rate', error);
}

console.log('\n=== courses.payout_tax_basis -> inclusive ===');
for (const c of courses) {
  console.log(`  ${c.name}: ${c.payout_tax_basis} -> inclusive`);
  const { error } = await supabase.from('courses').update({ payout_tax_basis: 'inclusive' }).eq('id', c.id);
  if (error) console.error('  ERROR updating course', error);
}
console.log('\n完了');
