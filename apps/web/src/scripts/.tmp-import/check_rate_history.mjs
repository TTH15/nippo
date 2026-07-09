import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: courses } = await supabase.from('courses').select('id, name, payout_tax_basis, revenue_tax_basis').in('name', ['ヤマト横大路','ヤマト壬生','ヤマト上京','ヤマト山城','ヤマト一乗寺','ヤマト下京','ヤマト宇治田原']);
console.log(JSON.stringify(courses, null, 2));
const ids = courses.map(c=>c.id);
const { data: rates } = await supabase.from('course_unit_rates').select('course_id, unit_id, payout_per_unit, revenue_per_unit, updated_at').in('course_id', ids).order('updated_at', {ascending:false});
const { data: units } = await supabase.from('units').select('id,name');
const unitName = new Map(units.map(u=>[u.id,u.name]));
const courseName = new Map(courses.map(c=>[c.id,c.name]));
console.log('\n=== rates with updated_at ===');
rates.forEach(r => console.log(`${courseName.get(r.course_id)} / ${unitName.get(r.unit_id)}: payout=${r.payout_per_unit} revenue=${r.revenue_per_unit} updated_at=${r.updated_at}`));
