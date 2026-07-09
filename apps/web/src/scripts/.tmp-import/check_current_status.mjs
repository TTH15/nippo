import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');let v=l.slice(i+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);return [l.slice(0,i),v];}));
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const ids = ['f1b38298-8427-41a1-b499-67b1aa39a62c','a18c96a5-038d-405e-94ac-687f213faef5','de956a43-5c21-415f-8b9e-99b63c695ed3','86ad82f8-d810-49fa-a394-942d28646aa9','92deff96-ae4c-4d89-b470-a97cb4b36af1','03a07f7d-2770-4096-a8ec-5eb22d09ef9f','afd3c43b-f540-4342-9474-b088652db882','f2d44515-cd83-4236-bd11-2da6b92cf503','56640412-bb80-48d7-b139-761f2adaf168'];
const { data } = await supabase.from('invoice_documents').select('id, invoice_no, client_name, status, amount').in('id', ids);
data.forEach(r => console.log(`${r.client_name} ${r.invoice_no} status=${r.status} amount=${r.amount}`));
