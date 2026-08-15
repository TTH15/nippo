import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError, hasCapabilityCached } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import {
  loadPendingChanges,
  toPublicChange,
  type PendingChangeInternal,
} from "@/server/notifications/pendingChanges";
import { dispatchNotifications, type NotificationInput } from "@/server/notifications/dispatch";
import { buildAssignmentFlex } from "@/server/line/flex";
import { getAppBaseUrl } from "@/server/appUrl";
import { buildChangeDedupeKey } from "@repo/core/logic/notificationMessage";

export const dynamic = "force-dynamic";

// ============================================================
// 確定後に変わった予定の「未通知の変更」（notification-flow §3 モード2）。
//
// ★自動では一切送らない。運営がシフト表を触っている最中は、
//   検討のための操作と本当の変更を機械が区別できないため。
//   GET で差分を出し、運営が内容を読んで POST したときだけ送る。
//
// GET  : 未通知の変更一覧（差分が無ければ空）
// POST : 指定した変更だけを送信（内容はサーバ側で計算し直す）
// ============================================================

type OrgSettings = {
  includeMeeting: boolean;
  includeVehicle: boolean;
  changeEnabled: boolean;
};

async function loadSettings(orgId: string): Promise<OrgSettings> {
  const { data } = await supabase
    .from("org_notification_settings")
    .select("assignment_include_meeting, assignment_include_vehicle, change_enabled")
    .eq("org_id", orgId)
    .maybeSingle();

  return {
    includeMeeting: data ? Boolean(data.assignment_include_meeting) : true,
    includeVehicle: data ? Boolean(data.assignment_include_vehicle) : true,
    changeEnabled: Boolean(data?.change_enabled),
  };
}

export async function GET(req: NextRequest) {
  // シフト表を見ている運営に出すバーのためのデータ。送信可否は capability で分ける
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const settings = await loadSettings(orgId);
  // 変更通知が OFF の org では検知そのものを止める（画面にも何も出さない）
  if (!settings.changeEnabled) {
    return NextResponse.json({ enabled: false, canSend: false, changes: [] });
  }

  try {
    const changes = await loadPendingChanges(orgId, settings);
    return NextResponse.json({
      enabled: true,
      canSend: await hasCapabilityCached(user, "can_send_notifications"),
      changes: changes.map(toPublicChange),
    });
  } catch (e) {
    console.error("[pending-changes] 差分の計算に失敗", e);
    return NextResponse.json({ error: "変更の確認に失敗しました" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const settings = await loadSettings(orgId);
  if (!settings.changeEnabled) {
    return NextResponse.json({ error: "変更の通知が無効です" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    items?: { date?: string; driverId?: string }[];
  };
  const requested = new Set(
    (body.items ?? [])
      .filter((i) => i.date && i.driverId)
      .map((i) => `${i.date} ${i.driverId}`),
  );
  if (requested.size === 0) {
    return NextResponse.json({ error: "送信する変更が指定されていません" }, { status: 400 });
  }

  // ★内容はクライアントから受け取らず、必ずここで計算し直す。
  //   画面を開いてから送信するまでの間に状況が変わっていても、送るのは常に最新の差分。
  const changes = await loadPendingChanges(orgId, settings);
  const targets = changes.filter((c) => requested.has(`${c.date} ${c.driverId}`));

  if (targets.length === 0) {
    // 送信ボタンを押すまでに差分が解消していた（元に戻した等）
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, stale: true });
  }

  const appBaseUrl = getAppBaseUrl();
  const inputs: NotificationInput[] = targets.map((change) => buildInput(orgId, change, settings, appBaseUrl));

  try {
    const result = await dispatchNotifications(orgId, inputs);
    return NextResponse.json({
      ok: true,
      sent: result.created,
      skipped: result.skipped,
      lineSent: result.lineSent,
      lineFailed: result.lineFailed,
    });
  } catch (e) {
    console.error("[pending-changes] 送信に失敗", e);
    return NextResponse.json({ error: "送信に失敗しました" }, { status: 500 });
  }
}

function buildInput(
  orgId: string,
  change: PendingChangeInternal,
  settings: OrgSettings,
  appBaseUrl: string | null,
): NotificationInput {
  return {
    driverId: change.driverId,
    identityId: change.identityId,
    kind: "change",
    title: change.title,
    body: change.body,
    payload: {
      date: change.date,
      // 次の変更検知の基準になる（＝これを伝えた、という記録）
      snapshot: change.after,
      changeKind: change.kind,
      fields: change.fields,
    },
    // 二重クリックや同時送信は同じキーになって1通に潰れる
    dedupeKey: buildChangeDedupeKey({
      orgId,
      date: change.date,
      driverId: change.driverId,
      seq: change.seq,
    }),
    lineMessages: [
      buildAssignmentFlex({
        kind: change.kind,
        title: change.title,
        body: change.body,
        dateLabel: change.dateLabel,
        date: change.date,
        before: change.before,
        after: change.after,
        endTimes: change.endTimes,
        includeMeeting: settings.includeMeeting,
        includeVehicle: settings.includeVehicle,
        appBaseUrl,
      }),
    ],
  };
}
