import { supabase } from "@/server/db/client";

/**
 * イベントが当該 org のものか検証する（サブリソース系ルートの入口ガード）。
 * event_teams / event_team_members / event_point_entries は org_id を持たず
 * event_id 経由でしかテナントに紐付かないため、書き込み前にここで default-deny する。
 */
export async function eventBelongsToOrg(eventId: string, orgId: string): Promise<boolean> {
  if (!eventId) return false;
  const { data, error } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) {
    console.error("[events/guard] event lookup error", error);
    return false;
  }
  return !!data;
}
