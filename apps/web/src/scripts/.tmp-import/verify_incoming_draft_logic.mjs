import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: orgs } = await supabase.from('organizations').select('id, code').limit(5);
console.log('orgs:', orgs);
const { data: drivers } = await supabase.from('drivers').select('id, name, org_id').eq('role', 'DRIVER').limit(5);
console.log('sample drivers:', drivers);
const { data: reports } = await supabase.from('daily_reports_v2').select('driver_id, report_date').order('report_date', { ascending: false }).limit(5);
console.log('recent reports:', reports);
