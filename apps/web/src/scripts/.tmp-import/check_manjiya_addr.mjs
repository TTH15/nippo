import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await supabase.from('invoice_addresses').select('*').eq('id', '7dadbd2c-1423-45fb-babf-48354d9afbe0').single();
console.log(JSON.stringify(data, null, 2));

// 直近の万事屋向け請求書のpayloadを1件参考に見る(4月分の一番新しいもの)
const { data: ref } = await supabase.from('invoice_documents').select('*').eq('id', '78ba33c4-b4ee-4392-b943-4172ab832e5d').single();
console.log('\n--- 参考: 2026-04 R06 payload ---');
console.log(JSON.stringify(ref.payload, null, 2).slice(0, 3000));
