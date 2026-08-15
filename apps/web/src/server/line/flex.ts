// ============================================================
// 予定通知の LINE カード（Flex Message）。
// notification-flow §6「チャネルは差し替え可能なアダプタ」＝ここは LINE の見た目専用で、
// 何を伝えるか（文面）は core/logic/notificationMessage が決める。
//
// テキストと同じ内容を altText に入れる:
//   - Flex 非対応の環境やスマホの通知バナーではテキストがそのまま出る
//   - インボックス（真実）と LINE で文言が食い違わない
//
// 通数課金はメッセージ1通単位なので、カード化してもコストはテキストと同じ。
// ============================================================
import type { AssignmentEntry, DaySnapshot } from "@repo/core/logic/notificationMessage";
import { buildGoogleCalendarUrl } from "@repo/core/logic/calendarLink";
import type { LineMessage } from "./client";

export type CardKind = "assignment" | "rest_day" | "added" | "changed" | "canceled";

/** カードの見出し。種別ごとに色を変え、開いた瞬間に何の通知か分かるようにする。 */
const ACCENT: Record<CardKind, { bg: string; caption: string }> = {
  assignment: { bg: "#1E293B", caption: "あすの予定" },
  rest_day: { bg: "#64748B", caption: "あすの予定" },
  added: { bg: "#1E293B", caption: "予定が追加されました" },
  changed: { bg: "#D97706", caption: "予定が変わりました" },
  canceled: { bg: "#BE123C", caption: "予定が取り消されました" },
};

export type AssignmentCardInput = {
  kind: CardKind;
  /** インボックスと同じ件名・本文（altText に使う）。 */
  title: string;
  body: string;
  /** 「7月21日(月)」。 */
  dateLabel: string;
  /** YYYY-MM-DD。カレンダー追加リンクに使う。 */
  date: string;
  after: DaySnapshot;
  /** changed のときだけ渡す（変更前の値を取り消し線で添える）。 */
  before?: DaySnapshot | null;
  includeMeeting: boolean;
  includeVehicle: boolean;
  /** after.entries と同じ並びの終了時刻（カレンダー用。本文には出さない）。 */
  endTimes?: (string | null)[];
  /** アプリの基点 URL。null ならアプリ導線ボタンを省く。 */
  appBaseUrl: string | null;
};

type FlexNode = Record<string, unknown>;

/** ラベル＋値の1行。変更前の値があれば取り消し線で下に添える。 */
function detailRow(label: string, value: string, previous: string | null): FlexNode {
  const contents: FlexNode[] = [
    {
      type: "box",
      layout: "baseline",
      spacing: "sm",
      contents: [
        { type: "text", text: label, size: "sm", color: "#94A3B8", flex: 2 },
        { type: "text", text: value, size: "sm", color: "#0F172A", weight: "bold", flex: 5, wrap: true },
      ],
    },
  ];
  if (previous) {
    contents.push({
      type: "box",
      layout: "baseline",
      spacing: "sm",
      margin: "xs",
      contents: [
        { type: "text", text: " ", size: "xs", flex: 2 },
        {
          type: "text",
          text: previous,
          size: "xs",
          color: "#94A3B8",
          decoration: "line-through",
          flex: 5,
          wrap: true,
        },
      ],
    });
  }
  return { type: "box", layout: "vertical", contents };
}

/** 変わっていない値には取り消し線を出さない。 */
function previousOf(
  previous: AssignmentEntry | null,
  field: keyof AssignmentEntry,
  current: string | null,
): string | null {
  const value = previous?.[field];
  if (typeof value !== "string" || value === "" || value === current) return null;
  return value;
}

/** 1本ぶんの明細。 */
function entryRows(
  entry: AssignmentEntry,
  previous: AssignmentEntry | null,
  input: AssignmentCardInput,
): FlexNode[] {
  const rows: FlexNode[] = [
    detailRow("コース", entry.courseName, previousOf(previous, "courseName", entry.courseName)),
  ];
  if (input.includeMeeting) {
    if (entry.meetingTime) {
      rows.push(
        detailRow("集合時刻", entry.meetingTime, previousOf(previous, "meetingTime", entry.meetingTime)),
      );
    }
    if (entry.meetingPlace) {
      rows.push(
        detailRow("集合場所", entry.meetingPlace, previousOf(previous, "meetingPlace", entry.meetingPlace)),
      );
    }
  }
  if (input.includeVehicle && entry.plate) {
    rows.push(detailRow("車両", entry.plate, previousOf(previous, "plate", entry.plate)));
  }
  return rows;
}

function linkButton(label: string, uri: string): FlexNode {
  return { type: "button", style: "link", height: "sm", action: { type: "uri", label, uri } };
}

/**
 * 予定通知のカードを組み立てる。
 * 値が無い項目の行は落とす（notification-flow §7「無ければ degrade」）。
 */
export function buildAssignmentFlex(input: AssignmentCardInput): LineMessage {
  const accent = ACCENT[input.kind];
  const entries = input.after.entries;
  // 便数が変わっているときは index 同士の比較に意味が無い（本文の扱いと揃える）
  const comparable =
    input.before != null && input.before.entries.length === entries.length && input.kind === "changed";

  const rows: FlexNode[] = [];

  if (entries.length === 0) {
    rows.push({
      type: "text",
      text:
        input.kind === "canceled"
          ? "この日の割り当ては取り消されました。"
          : "この日のシフトは入っていません。",
      size: "sm",
      color: "#475569",
      wrap: true,
    });
    const previousNames = (input.before?.entries ?? []).map((e) => e.courseName).filter(Boolean);
    if (input.kind === "canceled" && previousNames.length > 0) {
      rows.push({ type: "separator", margin: "lg", color: "#E2E8F0" });
      rows.push({
        type: "box",
        layout: "vertical",
        margin: "lg",
        contents: [detailRow("変更前", previousNames.join("・"), null)],
      });
    }
  } else {
    entries.forEach((entry, i) => {
      if (i > 0) rows.push({ type: "separator", margin: "lg", color: "#E2E8F0" });
      rows.push({
        type: "box",
        layout: "vertical",
        spacing: "md",
        margin: i > 0 ? "lg" : "none",
        contents: entryRows(entry, comparable ? (input.before?.entries[i] ?? null) : null, input),
      });
    });
  }

  const buttons: FlexNode[] = [];
  if (input.kind !== "canceled") {
    entries.forEach((entry, i) => {
      const url = buildGoogleCalendarUrl({
        title: entry.courseName,
        date: input.date,
        startTime: input.includeMeeting ? entry.meetingTime : null,
        endTime: input.endTimes?.[i] ?? null,
        location: input.includeMeeting ? entry.meetingPlace : null,
      });
      // 複数便あるときはどれを入れるのか分かるようコース名を添える
      if (url) {
        buttons.push(
          linkButton(entries.length > 1 ? `カレンダーに追加（${entry.courseName}）` : "カレンダーに追加", url),
        );
      }
    });
  }
  if (input.appBaseUrl) {
    buttons.push(linkButton("アプリでシフトを見る", `${input.appBaseUrl}/shifts`));
  }

  const bubble: FlexNode = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      backgroundColor: accent.bg,
      contents: [
        { type: "text", text: accent.caption, size: "xs", color: "#FFFFFFCC" },
        { type: "text", text: input.dateLabel, size: "xl", weight: "bold", color: "#FFFFFF", margin: "xs" },
      ],
    },
    body: { type: "box", layout: "vertical", paddingAll: "16px", spacing: "md", contents: rows },
  };

  if (buttons.length > 0) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      paddingAll: "8px",
      paddingTop: "0px",
      contents: buttons,
    };
  }

  return {
    type: "flex",
    // 通知バナー・トーク一覧に出るのはこちら。テキスト時代と同じ見え方を保つ
    altText: `${input.title}\n\n${input.body}`.slice(0, 400),
    contents: bubble,
  };
}
