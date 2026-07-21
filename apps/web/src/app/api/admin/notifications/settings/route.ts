import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// 自動配信の設定（roadmap-2026-07 E④ / notification-flow §5）。
// GET: 現在の設定（未作成なら既定値を返す＝行が無くても画面が壊れない）
// PUT: 更新（upsert）
// 既定は全て OFF。有効化は運営が明示的に行う。
// ============================================================

type Settings = {
  assignmentEnabled: boolean;
  assignmentSendAt: string; // "HH:MM"
  assignmentIncludeMeeting: boolean;
  assignmentIncludeVehicle: boolean;
  restDayEnabled: boolean;
  changeEnabled: boolean;
};

const DEFAULTS: Settings = {
  assignmentEnabled: false,
  assignmentSendAt: "20:00",
  assignmentIncludeMeeting: true,
  assignmentIncludeVehicle: true,
  restDayEnabled: false,
  changeEnabled: false,
};

/** DB の time 型は "20:00:00" で返るため画面用に "20:00" へ丸める。 */
function toHHMM(value: string | null | undefined): string {
  if (!value) return DEFAULTS.assignmentSendAt;
  return value.slice(0, 5);
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { data, error } = await supabase
    .from("org_notification_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) {
    console.error("[notification-settings] 取得に失敗", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }

  if (!data) return NextResponse.json({ settings: DEFAULTS });

  return NextResponse.json({
    settings: {
      assignmentEnabled: data.assignment_enabled,
      assignmentSendAt: toHHMM(data.assignment_send_at as string),
      assignmentIncludeMeeting: data.assignment_include_meeting,
      assignmentIncludeVehicle: data.assignment_include_vehicle,
      restDayEnabled: data.rest_day_enabled,
      changeEnabled: data.change_enabled,
    } satisfies Settings,
  });
}

export async function PUT(req: NextRequest) {
  const user = await requirePermission(req, "can_send_notifications");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const input = (await req.json().catch(() => ({}))) as Partial<Settings>;

  // 送信時刻は "HH:MM" のみ受け付ける（不正値で cron が壊れないように）
  const sendAt = input.assignmentSendAt ?? DEFAULTS.assignmentSendAt;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendAt)) {
    return NextResponse.json({ error: "送信時刻の形式が不正です" }, { status: 400 });
  }

  const { error } = await supabase.from("org_notification_settings").upsert(
    {
      org_id: orgId,
      assignment_enabled: input.assignmentEnabled ?? DEFAULTS.assignmentEnabled,
      assignment_send_at: sendAt,
      assignment_include_meeting:
        input.assignmentIncludeMeeting ?? DEFAULTS.assignmentIncludeMeeting,
      assignment_include_vehicle:
        input.assignmentIncludeVehicle ?? DEFAULTS.assignmentIncludeVehicle,
      rest_day_enabled: input.restDayEnabled ?? DEFAULTS.restDayEnabled,
      change_enabled: input.changeEnabled ?? DEFAULTS.changeEnabled,
      updated_at: new Date().toISOString(),
      updated_by: user.driverId,
    },
    { onConflict: "org_id" },
  );
  if (error) {
    console.error("[notification-settings] 保存に失敗", error);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
