import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
for (const id of ['89e78ffc-9081-48e9-9b48-6e9702362655', 'f4aab704-6c82-451a-9088-eb3ce93baa2d']) {
  const { data } = await supabase.from('invoice_documents').select('*').eq('id', id).single();
  console.log(`\n### ${data.invoice_no} created_at=${data.created_at} counterparty_invoice_address_id=${data.counterparty_invoice_address_id} amount=${data.amount} ###`);
  console.log('main count:', data.payload?.tableData?.main?.length, 'deduct count:', data.payload?.tableData?.deduct?.length);
  console.log('notes:', data.payload?.notes);
  console.log('parties:', JSON.stringify(data.payload?.parties));
}
