import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { isUuid, isDateOnly } from "@/server/db/adminResourceScope";
import { reportLifecycleError } from "@/server/reports/lifecycleError";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const actor = await requirePermission(req, "can_edit_reports");
  if (isAuthError(actor)) return actor;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.expectedRevision !== "string" || !isUuid(body.driverId) || !isDateOnly(body.reportDate) || !Array.isArray(body.items) || !body.items.length || body.items.length>100 ||
      body.items.some((i: any) => !i || !isUuid(i.courseId) || !Number.isInteger(i.cycleNo ?? 0) || (i.cycleNo ?? 0)<0 ||
        (i.vehicleId!=null && !isUuid(i.vehicleId)) || (i.meterValue!=null && (!Number.isInteger(i.meterValue) || i.meterValue<0)) ||
        !Array.isArray(i.entries) || i.entries.length>200 || i.entries.some((e: any) => !e || !isUuid(e.unitId) || typeof e.fieldKey!=="string" || !e.fieldKey ||
          (e.valueNum!=null && (typeof e.valueNum!=="number" || !Number.isFinite(e.valueNum))) || (e.valueText!=null && typeof e.valueText!=="string")))) return NextResponse.json({ error: "日報の内容を確認してください" }, { status: 400 });
  const org=await resolveOrgId(actor.driverId);
  const target=await supabase.from("drivers").select("id").eq("org_id",org).eq("id",body.driverId).maybeSingle();
  if (target.error) return NextResponse.json({ error: "日報を読み込めませんでした" }, { status: 500 });
  if (!target.data) return NextResponse.json({ error: "ドライバーが見つかりません" }, { status: 404 });
  const { data,error }=await supabase.rpc("proxy_report_day", { p_org:org,p_actor:actor.driverId,p_driver:body.driverId,p_date:body.reportDate,p_items:body.items,p_expected:body.expectedRevision,p_key:crypto.randomUUID() });
  if (error) return reportLifecycleError(error,"日報を保存できませんでした。入力を残して再試行してください");
  return NextResponse.json(data);
}
