/** シフトセルの表示用状態。サーバー側の認可・保護とは別に扱う。 */
export type ShiftCorrectionState = "editable" | "past-locked" | "approved-locked" | "correction";

export function shiftCorrectionState(input: {
  date: string;
  today: string;
  hasFinalizedReport: boolean;
  correctionOpen: boolean;
}): ShiftCorrectionState {
  if (input.correctionOpen) return "correction";
  if (input.date < input.today) return input.hasFinalizedReport ? "approved-locked" : "past-locked";
  return "editable";
}
