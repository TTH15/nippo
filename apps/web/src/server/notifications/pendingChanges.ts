// ============================================================
// 「ドライバーに伝えた予定」と「現在の予定」の差分＝未通知の変更。
//
// ★イベント（変更操作）ではなく状態の差分で出す。
//   運営はセルを何度も触り、確認のために画面を行き来する。
//   操作を数えるとその途中経過が全部通知になってしまうため、
//   「最後に伝えた内容」と「今の内容」だけを比べる。結果として:
//     - 何度触り直しても差分は1件に畳まれる
//     - 元に戻せば差分は消える（通知するものが無くなる）
//     - 画面を再読み込みしても同じ結果になる
//
//   まだ通知していない日付には基準が無いので差分も出ない
//   ＝前日の通知前にいくら組み替えても運営の画面には何も現れない。
//
// 送信は運営の明示操作（POST /api/admin/shifts/pending-changes）でのみ行う。
// ============================================================
import { supabase } from "@/server/db/client";
import {
  buildChangeMessage,
  diffDay,
  EMPTY_DAY,
  type AssignmentChangeKind,
  type DaySnapshot,
  type IncludeOptions,
} from "@repo/core/logic/notificationMessage";
import { formatMonthDayWeekdayJP } from "@repo/core/logic/calendar";
import { fetchAllRows, IN_CLAUSE_BATCH_SIZE } from "@/server/aggregation/pagination";
import {
  loadAssignmentsByDate,
  loadOrgMembers,
  noAssignment,
  type DayAssignment,
} from "./assignments";

/** 変更を見に行く範囲（今日から何日先まで）。これより先はまだ通知していない。 */
const LOOKAHEAD_DAYS = 8;

/** 基準にする通知を探す期間。通知は前日夜に作られるので数日で足りるが余裕を持つ。 */
const BASELINE_LOOKBACK_DAYS = 21;

export type PendingChange = {
  date: string;
  /** 「7月21日(月)」。 */
  dateLabel: string;
  driverId: string;
  identityId: string;
  driverName: string;
  kind: AssignmentChangeKind;
  /** 変わった項目（"コース" 等）。 */
  fields: string[];
  /** 送る予定の件名・本文（運営が送信前に読むもの）。 */
  title: string;
  body: string;
  /** LINE 未連携ならアプリ内インボックスだけに届く。 */
  lineLinked: boolean;
  /** 冪等キー用の通し番号（既に送った変更通知の件数）。 */
  seq: number;
};

/** 送信時に必要な内部データ（画面には返さない）。 */
export type PendingChangeInternal = PendingChange & {
  before: DaySnapshot;
  after: DaySnapshot;
  endTimes: (string | null)[];
};

/** JST の暦日（YYYY-MM-DD）。 */
function jstDate(offsetDays = 0): string {
  const todayJst = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const d = new Date(`${todayJst}T12:00:00+09:00`);
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

export type BaselineRow = {
  driver_id: string | null;
  kind: string;
  payload: { date?: string; snapshot?: DaySnapshot } | null;
  created_at: string;
};

export type Baselines = {
  /** `${date} ${driverId}` → 最後に伝えた内容。 */
  byDriver: Map<string, { snapshot: DaySnapshot; seq: number }>;
  /** 定時通知を送り終えた日付。この日以降は「伝えていない＝休みと伝えた」とみなせる。 */
  notifiedDates: Set<string>;
};

/**
 * 「最後に伝えた内容」を driver×日付ごとに集める。
 * 併せて、その日に既に送った変更通知の件数（seq）も数える。
 */
async function loadBaselines(orgId: string, dates: string[]): Promise<Baselines> {
  const since = new Date();
  since.setDate(since.getDate() - BASELINE_LOOKBACK_DAYS);

  // ★1000行で切れると「最新の基準」が落ちて誤検知に直結するため必ずページングする。
  //   ドライバー30人 × 3週間だけで 1000 行を超える（昇順なので切り捨てられるのは
  //   まさに今欲しい直近の行）。ORDER BY は (created_at, id) で一意にする。
  const rows = await fetchAllRows<BaselineRow>((from, to) =>
    supabase
      .from("notifications")
      .select("driver_id, kind, payload, created_at")
      .eq("org_id", orgId)
      .in("kind", ["assignment", "rest_day", "change"])
      .gte("created_at", since.toISOString())
      // 後勝ちで基準を決めるため昇順に読む
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  return reduceBaselines(rows, dates);
}

/**
 * 通知履歴を「最後に伝えた内容」に畳み込む（判定の純粋部分・テスト対象）。
 * rows は created_at 昇順であること（後勝ちで基準を決めるため）。
 */
export function reduceBaselines(rows: BaselineRow[], dates: string[]): Baselines {
  const wanted = new Set(dates);
  const byDriver = new Map<string, { snapshot: DaySnapshot; seq: number }>();
  const notifiedDates = new Set<string>();

  for (const row of rows) {
    const date = row.payload?.date;
    const snapshot = row.payload?.snapshot;
    // snapshot を持たない古い通知は基準にできない（この機能の導入前に送ったもの）
    if (!row.driver_id || !date || !wanted.has(date) || !snapshot?.entries) continue;

    // 定時通知が流れた日か（変更通知だけでは「その日を配信済み」とは言えない）
    if (row.kind === "assignment" || row.kind === "rest_day") notifiedDates.add(date);

    const key = `${date} ${row.driver_id}`;
    const prev = byDriver.get(key);
    byDriver.set(key, {
      snapshot,
      seq: (prev?.seq ?? 0) + (row.kind === "change" ? 1 : 0),
    });
  }

  return { byDriver, notifiedDates };
}

/** LINE 連携済みの identity（未連携は表示で区別する）。 */
async function loadLinkedIdentities(identityIds: string[]): Promise<Set<string>> {
  const linked = new Set<string>();
  // IN 句に UUID を並べ過ぎると PostgREST のヘッダ上限で黙って失敗するため分割する
  for (let i = 0; i < identityIds.length; i += IN_CLAUSE_BATCH_SIZE) {
    const batch = identityIds.slice(i, i + IN_CLAUSE_BATCH_SIZE);
    const { data } = await supabase
      .from("identities")
      .select("id")
      .in("id", batch)
      .not("line_user_id", "is", null)
      .is("line_blocked_at", null);
    for (const row of data ?? []) linked.add(row.id as string);
  }
  return linked;
}

/**
 * 未通知の変更を洗い出す。差分が無ければ空配列。
 * 対象は「今日以降」かつ「既に通知を送った日付」だけ。
 */
export async function loadPendingChanges(
  orgId: string,
  options: IncludeOptions,
): Promise<PendingChangeInternal[]> {
  const dates = Array.from({ length: LOOKAHEAD_DAYS }, (_, i) => jstDate(i));

  const [members, assignmentsByDate, baselines] = await Promise.all([
    loadOrgMembers(orgId),
    loadAssignmentsByDate(orgId, dates),
    loadBaselines(orgId, dates),
  ]);

  const linked = await loadLinkedIdentities(members.map((m) => m.identityId));
  const changes: PendingChangeInternal[] = [];

  for (const date of dates) {
    const assignments = assignmentsByDate.get(date) ?? new Map<string, DayAssignment>();
    for (const member of members) {
      const recorded = baselines.byDriver.get(`${date} ${member.driverId}`);
      // その人宛の通知が無くても、定時通知が流れ終わった日なら
      // 「割り当ては無い」と伝わっている状態とみなす。こうしないと、通知後に
      // 初めて割り当てられた人（休みの通知が OFF なら通知レコードが1件も無い）の
      // 追加を検知できない。
      const baseline =
        recorded ?? (baselines.notifiedDates.has(date) ? { snapshot: EMPTY_DAY, seq: 0 } : null);
      // まだ何も通知していない日 = 伝えた内容が無い = 変更のしようがない
      if (!baseline) continue;

      const current = assignments.get(member.driverId) ?? noAssignment();
      const diff = diffDay(baseline.snapshot, current.snapshot, options);
      if (!diff) continue;

      const dateLabel = formatMonthDayWeekdayJP(date);
      const { title, body } = buildChangeMessage({
        dateLabel,
        diff,
        before: baseline.snapshot,
        after: current.snapshot,
        ...options,
      });

      changes.push({
        date,
        dateLabel,
        driverId: member.driverId,
        identityId: member.identityId,
        driverName: member.name,
        kind: diff.kind,
        fields: diff.fields,
        title,
        body,
        lineLinked: linked.has(member.identityId),
        seq: baseline.seq,
        before: baseline.snapshot,
        after: current.snapshot,
        endTimes: current.endTimes,
      });
    }
  }

  return changes;
}

/** 画面に返す形（内部データを落とす）。 */
export function toPublicChange(change: PendingChangeInternal): PendingChange {
  const { before: _before, after: _after, endTimes: _endTimes, ...rest } = change;
  return rest;
}
