import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const ids = ['0fff17ec-5077-4281-ad7d-87dcb7326ef5','c48d1974-cf1a-4f67-b8c6-5444a1235ea8'];
const res = await supabase.from('course_fixed_rates').select('id, course_id, fixed_payout').in('course_id', ids);
console.log(JSON.stringify(res, null, 2));
