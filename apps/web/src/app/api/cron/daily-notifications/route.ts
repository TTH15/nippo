import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";
import { dispatchNotifications, type NotificationInput } from "@/server/notifications/dispatch";
import {
  buildAssignmentMessage,
  buildRestDayMessage,
  buildDedupeKey,
  formatPlateOneLine,
  toDisplayTime,
} from "@repo/core/logic/notificationMessage";

export const dynamic = "force-dynamic";

// ============================================================
// 翌日アサイン通知の定時バッチ（notification-flow §3 モード1）。
// Vercel Cron から毎時0分に叩かれ、「今が org の送信時刻か」を各 org 判定する
// （送信時刻は org ごとに可変なため、cron 式は固定にして中で振り分ける）。
//
// 保護: CRON_SECRET（Vercel Cron は Authorization: Bearer <CRON_SECRET> を付ける）。
// 冪等性: dedupeKey「org×日×種別×membership」で二重送信を抑止（dispatch 側で吸収）。
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

/** 「7/21(月)」形式のラベル。 */
function formatDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00+09:00`);
  const week = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${week})`;
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
  const dateLabel = formatDateLabel(date);

  // --- 対象日のシフト（shifts に org_id が無いため courses 経由で org を絞る）---
  const { data: shifts } = await supabase
    .from("shifts")
    .select(
      `id, shift_date, driver_id, vehicle_id, meeting_place, meeting_time,
       courses!inner (id, org_id, name, summary_title, meeting_place, meeting_time)`,
    )
    .eq("shift_date", date)
    .eq("courses.org_id", orgId)
    .not("driver_id", "is", null);

  // --- 受信可能なメンバー（identity 必須。dispatch がここから配信先を導出する）---
  const { data: members } = await supabase
    .from("drivers")
    .select("id, identity_id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .eq("works_as_driver", true)
    .not("identity_id", "is", null);

  const identityByDriver = new Map(
    (members ?? []).map((m) => [m.id as string, m.identity_id as string]),
  );

  // --- 車両は入れ子 join せず、まとめて引いて Map で結合（本リポの確立パターン）---
  const vehicleIds = [
    ...new Set((shifts ?? []).map((s) => s.vehicle_id).filter(Boolean) as string[]),
  ];
  const { data: vehicles } = vehicleIds.length
    ? await supabase
        .from("vehicles")
        .select("id, number_prefix, number_class, number_hiragana, number_numeric")
        .in("id", vehicleIds)
    : { data: [] };
  const vehicleById = new Map((vehicles ?? []).map((v) => [v.id as string, v]));

  const inputs: NotificationInput[] = [];
  const assignedDriverIds = new Set<string>();

  for (const shift of shifts ?? []) {
    const driverId = shift.driver_id as string;
    const identityId = identityByDriver.get(driverId);
    // 退職者・identity 未設定は対象外（dispatch の越境アサートにも掛かるため事前に除く）
    if (!identityId) continue;

    // supabase の入れ子は配列で返る場合があるため正規化する
    const course = (Array.isArray(shift.courses) ? shift.courses[0] : shift.courses) as {
      name: string;
      summary_title: string | null;
      meeting_place: string | null;
      meeting_time: string | null;
    } | null;
    if (!course) continue;

    assignedDriverIds.add(driverId);

    // 実効値 = shifts の上書き ?? コース標準（roadmap A2）
    const { title, body } = buildAssignmentMessage({
      courseName: course.summary_title?.trim() || course.name,
      meetingPlace: (shift.meeting_place as string | null) ?? course.meeting_place,
      meetingTime: toDisplayTime((shift.meeting_time as string | null) ?? course.meeting_time),
      plate: formatPlateOneLine(vehicleById.get(shift.vehicle_id as string) ?? null),
      dateLabel,
      includeMeeting: options.includeMeeting,
      includeVehicle: options.includeVehicle,
    });

    inputs.push({
      driverId,
      identityId,
      kind: "assignment",
      title,
      body,
      payload: { date, shiftId: shift.id },
      dedupeKey: buildDedupeKey({ orgId, date, kind: "assignment", driverId }),
    });
  }

  // --- 休み通知（org 設定が ON のときだけ）---
  if (options.restDayEnabled) {
    for (const [driverId, identityId] of identityByDriver) {
      if (assignedDriverIds.has(driverId)) continue;
      const { title, body } = buildRestDayMessage(dateLabel);
      inputs.push({
        driverId,
        identityId,
        kind: "rest_day",
        title,
        body,
        payload: { date },
        dedupeKey: buildDedupeKey({ orgId, date, kind: "rest_day", driverId }),
      });
    }
  }

  if (inputs.length === 0) return { sent: 0, skipped: 0 };

  const result = await dispatchNotifications(orgId, inputs);
  return { sent: result.created, skipped: result.skipped };
}
