import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { isUuid, isDateOnly } from "@/server/db/adminResourceScope";
import { reportLifecycleError } from "@/server/reports/lifecycleError";
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission(req, "can_edit_reports");
  if (isAuthError(actor)) return actor;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!isUuid(id) || !body || (body.report_date != null && !isDateOnly(body.report_date)) ||
      typeof body.expectedSubmittedAt !== "string" || !Number.isFinite(Date.parse(body.expectedSubmittedAt)) ||
      (body.entries != null && (!Array.isArray(body.entries) || body.entries.length > 200 || body.entries.some((e: any) => !e || !isUuid(e.unitId) ||
        typeof e.fieldKey !== "string" || !e.fieldKey || (e.valueNum != null && (typeof e.valueNum !== "number" || !Number.isFinite(e.valueNum))) ||
        (e.valueText != null && (typeof e.valueText !== "string" || e.valueText.length > 2000)))))) return NextResponse.json({ error: "日報の内容を確認してください" }, { status: 400 });
  const org = await resolveOrgId(actor.driverId);
  const { error } = await supabase.rpc("edit_report_entries", { p_org: org, p_actor: actor.driverId, p_id: id, p_date: body.report_date ?? null, p_entries: body.entries ?? null, p_expected: body.expectedSubmittedAt });
  if (error) return reportLifecycleError(error, "日報を保存できませんでした。入力を残して再試行してください");
  return NextResponse.json({ ok: true });
}
