import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const ACE_ORG_ID = '1314c7a1-0f86-44fd-8f60-01588735295a';
const { data, error } = await supabase.from('invoice_addresses').insert({
  company_code: 'ACE', org_id: ACE_ORG_ID, name: '山下運送',
  postal_code: '613-0044', address: '京都府久世郡久御山町藤和田馬場崎野15-1 511',
  phone: '075-631-1018'
}).select('id, name');
console.log(JSON.stringify(data, null, 2), error);
