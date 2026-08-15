import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { dispatchNotifications, type NotificationInput } from "@/server/notifications/dispatch";
import {
  loadAssignmentsByDate,
  loadOrgMembers,
  noAssignment,
} from "@/server/notifications/assignments";
import { buildAssignmentFlex } from "@/server/line/flex";
import { getAppBaseUrl } from "@/server/appUrl";
import {
  buildDayMessage,
  buildRestDayMessage,
  buildDedupeKey,
} from "@repo/core/logic/notificationMessage";
import { formatMonthDayWeekdayJP } from "@repo/core/logic/calendar";

export const dynamic = "force-dynamic";

// ============================================================
// 翌日アサイン通知の定時バッチ（notification-flow §3 モード1）。
// Vercel Cron から毎時0分に叩かれ、「今が org の送信時刻か」を各 org 判定する
// （送信時刻は org ごとに可変なため、cron 式は固定にして中で振り分ける）。
//
// 保護: CRON_SECRET（Vercel Cron は Authorization: Bearer <CRON_SECRET> を付ける）。
// 冪等性: dedupeKey「org×日×種別×membership」で二重送信を抑止（dispatch 側で吸収）。
//
// ★送った内容は payload.snapshot に残す。これが「ドライバーに伝えた内容」の記録になり、
//   後からの変更検知（/api/admin/shifts/pending-changes）はこれと現在のシフトを比べる。
//
// 手動実行も可能（?date=YYYY-MM-DD&force=1）。運用で「今すぐ送りたい」時に使う。
// ============================================================

/** JST の日付文字列（YYYY-MM-DD）。正午基準で UTC ずれの影響を避ける。 */
function jstDateString(offsetDays = 0): string {
  const todayJst = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const d = new Date(`${todayJst}T12:00:00+09:00`);
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** JST の現在時（0〜23）。 */
function jstHour(): number {
  return Number(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false }),
  );
}

export async function GET(req: NextRequest) {
  // Vercel Cron / 手動実行の認証。未設定の環境では動かさない（誤爆防止）。
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET が未設定です" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const targetDate = url.searchParams.get("date") ?? jstDateString(1); // 既定は「翌日」
  const currentHour = jstHour();

  // 自動配信が有効な org だけを対象にする
  const { data: settingsRows, error } = await supabase
    .from("org_notification_settings")
    // tenant-scope-ok: cron は全org を走査する設計（org ごとに sendForOrg でスコープを閉じる）
    .select("*")
    .eq("assignment_enabled", true);
  if (error) {
    console.error("[cron/daily-notifications] 設定の取得に失敗", error);
    return NextResponse.json({ error: "設定の取得に失敗しました" }, { status: 500 });
  }

  const results: { orgId: string; sent: number; skipped: number; reason?: string }[] = [];

  for (const settings of settingsRows ?? []) {
    const orgId = settings.org_id as string;
    const sendHour = Number((settings.assignment_send_at as string).slice(0, 2));

    // 毎時起動なので、その org の送信時刻の回だけ実行する
    if (!force && sendHour !== currentHour) {
      results.push({ orgId, sent: 0, skipped: 0, reason: "not_send_hour" });
      continue;
    }

    try {
      const result = await sendForOrg(orgId, targetDate, {
        includeMeeting: Boolean(settings.assignment_include_meeting),
        includeVehicle: Boolean(settings.assignment_include_vehicle),
        restDayEnabled: Boolean(settings.rest_day_enabled),
      });
      results.push({ orgId, ...result });
    } catch (e) {
      console.error(`[cron/daily-notifications] org=${orgId} の送信に失敗`, e);
      results.push({ orgId, sent: 0, skipped: 0, reason: "error" });
    }
  }

  return NextResponse.json({ ok: true, date: targetDate, results });
}

async function sendForOrg(
  orgId: string,
  date: string,
  options: { includeMeeting: boolean; includeVehicle: boolean; restDayEnabled: boolean },
): Promise<{ sent: number; skipped: number }> {
  const dateLabel = formatMonthDayWeekdayJP(date);
  const appBaseUrl = getAppBaseUrl();

  const [members, assignmentsByDate] = await Promise.all([
    loadOrgMembers(orgId),
    loadAssignmentsByDate(orgId, [date]),
  ]);
  const assignments = assignmentsByDate.get(date) ?? new Map();

  const inputs: NotificationInput[] = [];

  for (const member of members) {
    const assignment = assignments.get(member.driverId) ?? noAssignment();
    const assigned = assignment.snapshot.entries.length > 0;

    // 割当が無い人は org 設定が ON のときだけ「休み」を送る
    if (!assigned && !options.restDayEnabled) continue;

    const { title, body } = assigned
      ? buildDayMessage({ dateLabel, snapshot: assignment.snapshot, ...options })
      : buildRestDayMessage(dateLabel);

    inputs.push({
      driverId: member.driverId,
      identityId: member.identityId,
      kind: assigned ? "assignment" : "rest_day",
      title,
      body,
      payload: {
        date,
        // ★変更検知の基準。「この内容を伝えた」という記録
        snapshot: assignment.snapshot,
        includeMeeting: options.includeMeeting,
        includeVehicle: options.includeVehicle,
      },
      dedupeKey: buildDedupeKey({
        orgId,
        date,
        kind: assigned ? "assignment" : "rest_day",
        driverId: member.driverId,
      }),
      lineMessages: [
        buildAssignmentFlex({
          kind: assigned ? "assignment" : "rest_day",
          title,
          body,
          dateLabel,
          date,
          after: assignment.snapshot,
          endTimes: assignment.endTimes,
          includeMeeting: options.includeMeeting,
          includeVehicle: options.includeVehicle,
          appBaseUrl,
        }),
      ],
    });
  }

  if (inputs.length === 0) return { sent: 0, skipped: 0 };

  const result = await dispatchNotifications(orgId, inputs);
  return { sent: result.created, skipped: result.skipped };
}
