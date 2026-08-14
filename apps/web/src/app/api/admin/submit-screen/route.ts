import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { loadOrgCarrierIds } from "@/server/carriers/orgCarriers";
import { loadUnitFieldsForUnits } from "@/server/carriers/unitFields";
import { supabase } from "@/server/db/client";
import {
  loadSubmitScreenConfig,
  saveSubmitScreenConfig,
  defaultSubmitScreenConfig,
  normalizeRankingSource,
  normalizeFormNotice,
  type SubmitScreenConfig,
} from "@/server/submitScreen/config";
import { normalizeBlocks } from "@/server/submitScreen/blocks";

export const dynamic = "force-dynamic";

// GET: 設定 ＋ 設定UI用の drivers / carriers→units→fields
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_org_settings");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const orgCarrierIds = await loadOrgCarrierIds(supabase, orgId);
  const carriersQ = supabase.from("carriers").select("*").order("sort_order");
  const unitsQ = supabase.from("units").select("*").order("sort_order");

  const [config, { data: drivers }, { data: carriers }, { data: units }, { data: events }] =
    await Promise.all([
      loadSubmitScreenConfig(supabase, orgId),
      supabase.from("drivers").select("id, name, display_name").eq("org_id", orgId).eq("works_as_driver", true).order("name"),
      orgCarrierIds ? carriersQ.in("id", orgCarrierIds) : carriersQ,
      orgCarrierIds ? unitsQ.in("carrier_id", orgCarrierIds) : unitsQ,
      // 067 未適用でも GET 全体は壊さない（エラー時は events=null→[]）。
      supabase
        .from("events")
        .select("id, name, status, starts_on, ends_on, team_ranking_visible_to_drivers")
        // イベントはテナント固有。設定UIの選択肢に他社イベントを出さない
        .eq("org_id", orgId)
        .order("starts_on", { ascending: false }),
    ]);

  // unit_fields は org で絞った units 経由で取得（全件SELECTは他社分の転送＋1000行切り詰め）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fields: any[] = [];
  try {
    fields = await loadUnitFieldsForUnits(supabase, (units ?? []).map((u: { id: string }) => u.id));
  } catch (e) {
    console.error(e);
  }

  const fieldsByUnit = new Map<string, unknown[]>();
  (fields ?? []).forEach((f: { unit_id: string }) => {
    const arr = fieldsByUnit.get(f.unit_id) ?? [];
    arr.push(f);
    fieldsByUnit.set(f.unit_id, arr);
  });
  const unitsByCarrier = new Map<string, unknown[]>();
  (units ?? []).forEach((u: { id: string; carrier_id: string }) => {
    const arr = unitsByCarrier.get(u.carrier_id) ?? [];
    arr.push({ ...u, fields: fieldsByUnit.get(u.id) ?? [] });
    unitsByCarrier.set(u.carrier_id, arr);
  });
  const carrierTree = (carriers ?? []).map((c: { id: string }) => ({
    ...c,
    units: unitsByCarrier.get(c.id) ?? [],
  }));

  return NextResponse.json({ config, drivers: drivers ?? [], carriers: carrierTree, events: events ?? [] });
}

// PUT: 設定を保存
export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_submit_screen");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const body = await req.json().catch(() => ({}));
  const base = defaultSubmitScreenConfig();
  const rankingSource = normalizeRankingSource(body.rankingSource, body.showRanking === false ? "none" : "auto");
  const cfg: SubmitScreenConfig = {
    metricLabel: typeof body.metricLabel === "string" && body.metricLabel.trim() ? body.metricLabel.trim() : base.metricLabel,
    metricFields: Array.isArray(body.metricFields)
      ? body.metricFields
          .filter((f: unknown) => f && typeof (f as { unitId?: unknown }).unitId === "string" && typeof (f as { fieldKey?: unknown }).fieldKey === "string")
          .map((f: { unitId: string; fieldKey: string }) => ({ unitId: f.unitId, fieldKey: f.fieldKey }))
      : [],
    targetDriverIds: Array.isArray(body.targetDriverIds)
      ? body.targetDriverIds.filter((x: unknown): x is string => typeof x === "string")
      : [],
    period: "current_month",
    rankingSource,
    linkedEventId: typeof body.linkedEventId === "string" && body.linkedEventId ? body.linkedEventId : null,
    thanksTitle: typeof body.thanksTitle === "string" ? body.thanksTitle.trim().slice(0, 100) : base.thanksTitle,
    thanksMessage: typeof body.thanksMessage === "string" ? body.thanksMessage.trim().slice(0, 300) : "",
    showRanking: rankingSource !== "none",
    teamRankingVisibleToDrivers: body.teamRankingVisibleToDrivers === true,
    blocks: Array.isArray(body.blocks) ? normalizeBlocks(body.blocks) : null,
    formNotice: normalizeFormNotice(body.formNotice),
  };

  try {
    await saveSubmitScreenConfig(supabase, orgId, cfg);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "保存に失敗しました（migration 061/067/081 未適用の可能性）" },
      { status: 500 },
    );
  }

  // イベント毎の表示設定（順位公開）の更新。設定ページから対象イベントの公開ON/OFFを保存する。
  if (Array.isArray(body.eventVisibility)) {
    for (const ev of body.eventVisibility) {
      const id = ev && typeof ev.id === "string" ? ev.id : "";
      if (!id) continue;
      // id はクライアント指定。org を併せて絞らないと他社イベントの公開設定を書き換えられる
      const { error: evErr } = await supabase
        .from("events")
        .update({ team_ranking_visible_to_drivers: ev.visible === true })
        .eq("id", id)
        .eq("org_id", orgId);
      if (evErr) console.error("[admin/submit-screen] event visibility update error", evErr);
    }
  }

  return NextResponse.json({ ok: true, config: cfg });
}
