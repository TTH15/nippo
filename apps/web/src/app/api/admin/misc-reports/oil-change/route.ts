import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { normalizeAttachments } from "@/server/reportKinds/fields";
import { signAttachments } from "@/server/reportKinds/attachments";

export const dynamic = "force-dynamic";

type Entry = {
  driver: { id: string; name: string; display_name: string | null };
  report: Record<string, unknown>;
};

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_vehicles");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  try {
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") || "30");
    const cursorRaw = Number(req.nextUrl.searchParams.get("cursor") || "0");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 30;
    const offset = Number.isFinite(cursorRaw) ? Math.max(0, Math.floor(cursorRaw)) : 0;
    const status = req.nextUrl.searchParams.get("status") === "approved" ? "approved" : "pending";
    let query = supabase
      .from("oil_change_reports")
      .select(`
        *,
        vehicles ( id, number_prefix, number_class, number_hiragana, number_numeric, manufacturer, brand )
      `)
      .eq("org_id", orgId);

    if (status === "approved") {
      query = query.not("approved_at", "is", null).order("approved_at", { ascending: false });
    } else {
      query = query
        .is("approved_at", null)
        .is("rejected_at", null)
        .order("submitted_at", { ascending: false });
    }

    const { data: reports, error: reportErr } = await query.range(offset, offset + limit);

    if (reportErr) {
      console.error("[admin/misc-reports/oil-change] reports error", reportErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const rows = reports ?? [];
    if (!rows.length) return NextResponse.json({ entries: [], nextCursor: null, hasMore: false });

    const hasMore = rows.length > limit;
    const pagedRows = hasMore ? rows.slice(0, limit) : rows;
    const pagedDriverIds = Array.from(new Set(pagedRows.map((r: { driver_id: string }) => r.driver_id).filter(Boolean)));
    const { data: pagedDrivers, error: pagedDriverErr } = await supabase
      .from("drivers")
      .select("id, name, display_name")
      .in("id", pagedDriverIds);

    if (pagedDriverErr) {
      console.error("[admin/misc-reports/oil-change] paged drivers error", pagedDriverErr);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    const pagedDriverMap = new Map<string, { id: string; name: string; display_name: string | null }>();
    (pagedDrivers ?? []).forEach((d: { id: string; name: string; display_name: string | null }) => {
      pagedDriverMap.set(d.id, { id: d.id, name: d.name, display_name: d.display_name ?? null });
    });

    // 添付に短時間の署名URLを付与（閲覧用）。
    await Promise.all(
      pagedRows.map(async (r: Record<string, unknown>) => {
        const atts = normalizeAttachments(r.attachments);
        if (atts.length > 0) r.attachments = await signAttachments(supabase, atts);
      }),
    );

    const pagedEntries: Entry[] = [];
    pagedRows.forEach((r: Record<string, unknown> & { driver_id: string }) => {
      const driver = pagedDriverMap.get(r.driver_id);
      if (!driver) return;
      pagedEntries.push({ driver, report: r });
    });

    const response = NextResponse.json({
      entries: pagedEntries,
      nextCursor: hasMore ? String(offset + limit) : null,
      hasMore,
    });
    // 未承認(pending)は承認ワークフローの鮮度が命なのでキャッシュしない。
    // 承認済(approved)は変化が少ないため短時間キャッシュ＋SWRで再検証。
    response.headers.set(
      "Cache-Control",
      status === "approved" ? "private, max-age=30, stale-while-revalidate=300" : "no-store",
    );
    return response;
  } catch (err) {
    console.error("[admin/misc-reports/oil-change] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
