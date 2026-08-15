// ============================================================
// 「その日ドライバーに何が割り当たっているか」を読む共通層。
//
// 定時バッチ（翌日アサイン通知）と変更検知の両方がここを通る。
// 別々に組み立てると、送った内容と比較する内容が食い違い、
// 「変わっていないのに変更通知が出る」「変わったのに出ない」が起きるため。
// ============================================================
import { supabase } from "@/server/db/client";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";
import {
  formatPlateOneLine,
  toDisplayTime,
  type AssignmentEntry,
  type DaySnapshot,
} from "@repo/core/logic/notificationMessage";

export type OrgMember = {
  /** membership（drivers.id）。通知の受信者単位。 */
  driverId: string;
  identityId: string;
  name: string;
};

export type DayAssignment = {
  snapshot: DaySnapshot;
  /** snapshot.entries と同じ並びの終業時刻（カレンダー追加リンク用）。 */
  endTimes: (string | null)[];
};

/** 日付 → ドライバー → その日の予定。 */
export type AssignmentsByDate = Map<string, Map<string, DayAssignment>>;

/**
 * 通知を受け取れる active メンバー。
 * identity が無い人は配信先を解決できないので最初から除く
 * （dispatch の越境アサートに掛ける前に落とす）。
 */
export async function loadOrgMembers(orgId: string): Promise<OrgMember[]> {
  const { data, error } = await supabase
    .from("drivers")
    .select("id, identity_id, name, display_name")
    .eq("org_id", orgId)
    .eq("status", "active")
    .eq("works_as_driver", true)
    .not("identity_id", "is", null)
    .order("list_no", { ascending: true, nullsFirst: false })
    .order("name");
  if (error) throw new Error(`メンバーの取得に失敗しました: ${error.message}`);

  return (data ?? []).map((d) => ({
    driverId: d.id as string,
    identityId: d.identity_id as string,
    name: ((d.display_name as string | null)?.trim() || (d.name as string)) ?? "",
  }));
}

type VehicleRow = {
  id: string;
  number_prefix: string | null;
  number_class: string | null;
  number_hiragana: string | null;
  number_numeric: string | null;
};

type ShiftRow = {
  id: string;
  shift_date: string;
  slot: number | null;
  course_id: string | null;
  driver_id: string;
  vehicle_id: string | null;
  meeting_place: string | null;
  meeting_time: string | null;
  end_time: string | null;
  courses:
    | {
        name: string;
        summary_title: string | null;
        meeting_place: string | null;
        meeting_time: string | null;
        end_time: string | null;
      }
    | Array<{
        name: string;
        summary_title: string | null;
        meeting_place: string | null;
        meeting_time: string | null;
        end_time: string | null;
      }>
    | null;
};

/**
 * 指定した日付群の割り当てを読む。
 *
 * shifts に org_id 列が無いため、org の絞り込みは courses 経由で行う
 * （このリポの確立パターン。check:tenant の既知例外）。
 */
export async function loadAssignmentsByDate(
  orgId: string,
  dates: string[],
): Promise<AssignmentsByDate> {
  const byDate: AssignmentsByDate = new Map(dates.map((d) => [d, new Map()]));
  if (dates.length === 0) return byDate;

  const rows = await fetchAllRows<ShiftRow>((from, to) =>
    supabase
      .from("shifts")
      .select(
        `id, shift_date, slot, course_id, driver_id, vehicle_id, meeting_place, meeting_time, end_time,
         courses!inner (org_id, name, summary_title, meeting_place, meeting_time, end_time)`,
      )
      .in("shift_date", dates)
      .eq("courses.org_id", orgId)
      .not("driver_id", "is", null)
      // ★並び順は固定する。entries を index で突き合わせて差分を出すため、
      //   順序が揺れると「変わっていないのに変更」と誤検知する。
      //   (shift_date, course_id, slot) は UNIQUE なのでページング境界でも一意。
      .order("shift_date", { ascending: true })
      .order("slot", { ascending: true, nullsFirst: true })
      .order("course_id", { ascending: true })
      .range(from, to),
  );

  // 車両は入れ子 join せず、まとめて引いて Map で結合（本リポの確立パターン）
  const vehicleIds = [...new Set(rows.map((r) => r.vehicle_id).filter((v): v is string => !!v))];
  const vehicleById = new Map<string, VehicleRow>();
  for (let i = 0; i < vehicleIds.length; i += IN_CLAUSE_BATCH_SIZE) {
    const batch = vehicleIds.slice(i, i + IN_CLAUSE_BATCH_SIZE);
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, number_prefix, number_class, number_hiragana, number_numeric")
      .in("id", batch);
    for (const v of vehicles ?? []) vehicleById.set(v.id as string, v as VehicleRow);
  }

  for (const row of rows) {
    // supabase の入れ子は配列で返る場合があるため正規化する
    const course = Array.isArray(row.courses) ? row.courses[0] : row.courses;
    if (!course) continue;

    const day = byDate.get(row.shift_date);
    if (!day) continue;

    const entry: AssignmentEntry = {
      courseName: course.summary_title?.trim() || course.name,
      // 実効値 = shifts の上書き ?? コース標準（roadmap A2）
      meetingTime: toDisplayTime(row.meeting_time ?? course.meeting_time),
      meetingPlace: row.meeting_place ?? course.meeting_place,
      plate: formatPlateOneLine(vehicleById.get(row.vehicle_id ?? "") ?? null),
    };

    const current = day.get(row.driver_id) ?? { snapshot: { entries: [] }, endTimes: [] };
    current.snapshot.entries.push(entry);
    current.endTimes.push(toDisplayTime(row.end_time ?? course.end_time));
    day.set(row.driver_id, current);
  }

  return byDate;
}

/**
 * 割り当てが無い日（休み）。
 * 呼び出し側が entries を積むことがあるため、共有インスタンスではなく毎回新しく作る。
 */
export function noAssignment(): DayAssignment {
  return { snapshot: { entries: [] }, endTimes: [] };
}
