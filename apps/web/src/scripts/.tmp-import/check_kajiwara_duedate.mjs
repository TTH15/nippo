import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await supabase.from('invoice_documents').select('id, invoice_no, payload').eq('id', 'f1b38298-8427-41a1-b499-67b1aa39a62c').single();
console.log('dueDate:', JSON.stringify(data.payload.dueDate));
console.log('period:', JSON.stringify(data.payload.period));
console.log('displayBasis:', data.payload.displayBasis);
console.log('taxSettings:', JSON.stringify(data.payload.taxSettings));

// 元のR01(修正前)も確認
const { data: r01 } = await supabase.from('invoice_documents').select('payload').eq('id', '5c38127a-9757-4ff6-a1da-cc227ea211e5').single();
console.log('\nR01 dueDate:', JSON.stringify(r01.payload.dueDate));
console.log('R01 period:', JSON.stringify(r01.payload.period));
