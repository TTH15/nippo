// 諸報告（オイル交換・修理・経費等）フォームの純粋ロジック（プラットフォーム非依存）。
// フィールドの中身検証は server/reportKinds/fields の validateAnswers を共用する。
import type { AnswerAttachment } from "../types/reportFields";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** 報告日付("YYYY-MM-DD")・時刻("HH:MM")の形式が妥当か。 */
export function isValidReportDateTime(date: string, time: string): boolean {
  return DATE_RE.test(date) && TIME_RE.test(time);
}

/** 添付を fieldId ごとに件数集計する（validateAnswers に渡す形）。 */
export function countAttachmentsByField(
  attachments: AnswerAttachment[],
): Record<string, number> {
  const out: Record<string, number> = {};
  attachments.forEach((a) => {
    out[a.fieldId] = (out[a.fieldId] ?? 0) + 1;
  });
  return out;
}
