import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await supabase.from('invoice_documents').select('invoice_no, amount, payload').eq('id', 'f1b38298-8427-41a1-b499-67b1aa39a62c').single();
console.log('invoice_no:', data.invoice_no, 'amount:', data.amount);
console.log('dueDate:', data.payload.dueDate, 'period:', data.payload.period, 'displayBasis:', data.payload.displayBasis);
console.log('main:', JSON.stringify(data.payload.tableData.main, null, 1));
console.log('deduct:', JSON.stringify(data.payload.tableData.deduct, null, 1));
