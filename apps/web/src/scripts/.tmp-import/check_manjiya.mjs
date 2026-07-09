import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: drivers } = await supabase.from('drivers').select('id, name, display_name, status').ilike('name', '%万事屋%');
console.log('drivers(万事屋):', drivers);

const { data: addrs } = await supabase.from('invoice_addresses').select('id, name').ilike('name', '%万事屋%');
console.log('invoice_addresses(万事屋):', addrs);

const { data: carriers } = await supabase.from('carriers').select('id, name, code').ilike('name', '%万事屋%');
console.log('carriers(万事屋):', carriers);

// 池畑弘平・上手滉弥・杉本創都も探す(9名以外のPDF記載ドライバー)
const others = ['池畑', '上手', '杉本'];
for (const nm of others) {
  const { data } = await supabase.from('drivers').select('id, name, display_name, status').ilike('name', `%${nm}%`);
  console.log(`${nm}:`, data);
}

// 万事屋関連の既存invoice_documentsも確認(過去に作成済みか)
const { data: invs } = await supabase.from('invoice_documents').select('id, invoice_no, client_name, month_yyyy_mm, status, amount').ilike('client_name', '%万事屋%');
console.log('invoice_documents(万事屋 client_name一致):', invs);
