import type {SupabaseClient} from '@supabase/supabase-js';
import {createCourseReportFieldFilter,type CourseReportFieldFilter} from './courseReportFieldFilter';
export {allowAllReportFields} from './courseReportFieldFilter';
export type {CourseReportFieldFilter} from './courseReportFieldFilter';
export async function loadCourseReportFields(supabase:SupabaseClient,courseIds:string[]):Promise<CourseReportFieldFilter>{
 if(!courseIds.length)return createCourseReportFieldFilter([]);
 // tenant-scope-ok: courseIds are derived from scoped courses at the caller.
 const {data,error}=await supabase.from('course_report_fields').select('course_id, cycle_no, unit_id, field_key').in('course_id',courseIds);
 if(error)throw error;
 return createCourseReportFieldFilter(data??[]);
}
