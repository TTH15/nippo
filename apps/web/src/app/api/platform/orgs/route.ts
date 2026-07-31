import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { requirePlatformAdmin } from "@/server/platform";

export const dynamic = "force-dynamic";

// プラットフォームコンソール: org 一覧＋利用状況の集計（Phase 1・PII なし）。
// 返すのは件数・状態・日付のみ。個人名・売上明細・口座などのエンドポイントは作らない（設計方針）。

type OrgMetric = {
  id: string;
  code: string;
  name: string;
  joinCode: string | null;
  status: string;
  createdAt: string;
  activeDrivers: number;
  kycVerifiedDrivers: number;
  reportsThisMonth: number;
  workSessionsThisMonth: number;
  notificationsThisMonth: number;
  lineSentThisMonth: number;
  lastReportDate: string | null;
};

export async function GET(req: NextRequest) {
  const ctx = await requirePlatformAdmin(req);
  if (ctx instanceof NextResponse) return ctx;

  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("id, code, name, join_code, status, created_at")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[platform/orgs]", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const metrics: OrgMetric[] = await Promise.all(
    (orgs ?? []).map(async (o): Promise<OrgMetric> => {
      const [drivers, kyc, reports, sessions, notifs, line, lastReport] = await Promise.all([
        supabase.from("drivers").select("id", { count: "exact", head: true }).eq("org_id", o.id).eq("status", "active"),
        supabase
          .from("drivers")
          .select("id", { count: "exact", head: true })
          .eq("org_id", o.id)
          .eq("status", "active")
          .not("kyc_verified_at", "is", null),
        supabase
          .from("daily_reports_v2")
          .select("id", { count: "exact", head: true })
          .eq("org_id", o.id)
          .gte("report_date", monthStart),
        supabase
          .from("vehicle_sessions")
          .select("id", { count: "exact", head: true })
          .eq("org_id", o.id)
          .gte("started_at", monthStartIso),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("org_id", o.id)
          .gte("created_at", monthStartIso),
        supabase
          .from("notification_deliveries")
          .select("id, notifications!inner(org_id)", { count: "exact", head: true })
          .eq("notifications.org_id", o.id)
          .eq("channel", "line")
          .gte("sent_at", monthStartIso),
        supabase
          .from("daily_reports_v2")
          .select("report_date")
          .eq("org_id", o.id)
          .order("report_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        id: o.id,
        code: o.code,
        name: o.name,
        joinCode: o.join_code,
        status: o.status,
        createdAt: o.created_at,
        activeDrivers: drivers.count ?? 0,
        kycVerifiedDrivers: kyc.count ?? 0,
        reportsThisMonth: reports.count ?? 0,
        workSessionsThisMonth: sessions.count ?? 0,
        notificationsThisMonth: notifs.count ?? 0,
        lineSentThisMonth: line.count ?? 0,
        lastReportDate: (lastReport.data?.report_date as string | undefined) ?? null,
      };
    }),
  );

  return NextResponse.json({ orgs: metrics });
}
