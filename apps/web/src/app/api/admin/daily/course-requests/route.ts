import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { fetchAllRows } from "@/server/aggregation/pagination";
import { loadReportContents } from "@/server/aggregation/reportContent";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actor = await requirePermission(req, "can_view_reports");
  if (isAuthError(actor)) return actor;
  try {
    const org = actor.orgId ?? await resolveOrgId(actor.driverId);
    const requests = await fetchAllRows<any>((from, to) => supabase.from("report_course_requests")
      .select("id,driver_id,report_date,course_id,cycle_no,payload,submitted_at")
      .eq("org_id", org).eq("status", "pending").order("id").range(from, to));
    const keys = [...new Map(requests.map(q => [`${q.driver_id}:${q.report_date}`, q])).values()];
    const days = await Promise.all(keys.map(async day => {
      const { data: revision, error } = await supabase.rpc("report_day_revision", { p_org: org, p_driver: day.driver_id, p_date: day.report_date });
      if (error) throw error;
      const [driverResult, reportResult, courseResult] = await Promise.all([
        supabase.from("drivers").select("name,display_name").eq("id", day.driver_id).eq("org_id", org).single(),
        supabase.from("daily_reports_v2").select("id,course_id,cycle_no,approved_at,vehicle_id,meter_value").eq("org_id", org).eq("driver_id", day.driver_id).eq("report_date", day.report_date).is("rejected_at", null),
        supabase.from("courses").select("id,name,summary_title,color,carrier_id").eq("org_id", org),
      ]);
      if (driverResult.error || reportResult.error || courseResult.error) throw new Error("read failed");
      const courses = new Map((courseResult.data ?? []).map(c => [c.id, c]));
      const contents = await loadReportContents(supabase, org, (reportResult.data ?? []).map(r => r.id));
      const own = requests.filter(q => q.driver_id === day.driver_id && q.report_date === day.report_date);
      const carrierIds = [...new Set(own.map(q => courses.get(q.course_id)?.carrier_id).filter((id): id is string => !!id))];
      const unitsResult = carrierIds.length ? await supabase.from("units").select("id,name").in("carrier_id", carrierIds) : { data: [], error: null };
      if (unitsResult.error) throw unitsResult.error;
      const units = unitsResult.data ?? [];
      const fieldsResult = units.length ? await supabase.from("unit_fields").select("unit_id,field_key,label,input_type,group_label").in("unit_id", units.map(u => u.id)) : { data: [], error: null };
      if (fieldsResult.error) throw fieldsResult.error;
      const fields = fieldsResult.data ?? [];
      const result = {
        driverId: day.driver_id, driverName: driverResult.data.display_name || driverResult.data.name, date: day.report_date, revision,
        reports: (reportResult.data ?? []).map(r => ({ id: r.id, courseName: courses.get(r.course_id)?.summary_title || courses.get(r.course_id)?.name || "コース", cycleNo: r.cycle_no ?? 0, content: contents.get(r.id) ?? [], approved: !!r.approved_at })),
        requests: own.map(q => ({ id: q.id, courseName: courses.get(q.course_id)?.summary_title || courses.get(q.course_id)?.name || "コース", cycleNo: q.cycle_no,
          meterValue: q.payload.meterValue ?? null,
          content: units.map(u => ({ unitId: u.id, unitName: u.name, fields: (q.payload.entries ?? []).filter((e: any) => e.unitId === u.id).map((e: any) => {
            const f = fields.find(f => f.unit_id === u.id && f.field_key === e.fieldKey);
            return { fieldKey: e.fieldKey, label: f?.label ?? e.fieldKey, inputType: f?.input_type ?? "INT", groupLabel: f?.group_label ?? null, valueNum: e.valueNum ?? null, valueText: e.valueText ?? null };
          }) })).filter(u => u.fields.length),
        })),
      };
      const current = await supabase.rpc("report_day_revision", { p_org: org, p_driver: day.driver_id, p_date: day.report_date });
      if (current.error || current.data !== revision) throw new Error("day changed");
      return result;
    }));
    return NextResponse.json({ days }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "追加申請を読み込めませんでした" }, { status: 500 }); }
}
