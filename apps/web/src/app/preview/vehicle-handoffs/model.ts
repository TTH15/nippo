// 検討用の架空データと状態遷移。本番API・DB・通知には接続しない。
export const people = [
  { id: "driver-1", name: "佐藤", role: "月額リース" },
  { id: "driver-2", name: "田中", role: "日額リース" },
  { id: "driver-4", name: "高橋", role: "移動担当" },
];
export const places = [
  { id: "toyonaka", name: "豊中車庫" },
  { id: "kyoto", name: "京都車庫" },
  { id: "suita", name: "吹田車庫" },
];
export const sampleVehicle = { id: "vehicle-1", number_prefix: "大阪", number_class: "480", number_hiragana: "り", number_numeric: "1201", plate_color: "black" as const };
export const previewNow = "2026-09-01T09:00";
export type Use = { date: string; driverId: string; courseId: string; cycleNo: number; slot: number; placeId: string; start: string; end: string };
export const sampleUses: Use[] = [
  { date: "2026-09-03", driverId: "driver-1", courseId: "course-1", cycleNo: 0, slot: 1, placeId: "toyonaka", start: "07:30", end: "19:00" },
  { date: "2026-09-04", driverId: "driver-2", courseId: "course-3", cycleNo: 0, slot: 5, placeId: "kyoto", start: "07:00", end: "19:00" },
  { date: "2026-09-05", driverId: "driver-1", courseId: "course-1", cycleNo: 0, slot: 1, placeId: "toyonaka", start: "07:30", end: "19:00" },
  { date: "2026-09-06", driverId: "driver-1", courseId: "course-1", cycleNo: 0, slot: 1, placeId: "toyonaka", start: "07:30", end: "19:00" },
  { date: "2026-09-07", driverId: "driver-2", courseId: "course-1", cycleNo: 0, slot: 5, placeId: "toyonaka", start: "07:00", end: "19:00" },
];
export type Move = {
  id: string; vehicleId: string; ownerId: string; from: Use; to: Use;
  fromPlaceId: string; toPlaceId: string; assigneeId: string; dueAt: string;
  notifyMode: "previous_day" | "specified" | "none"; notifyDate: string; notifyTime: string;
  fuel: boolean; fuelPersonId: string; note: string;
  state: "needed" | "planned" | "arrived" | "cancelled"; revision: number;
  notice: "none" | "scheduled" | "sent" | "failed"; noticeKind: "request" | "change" | "cancel";
  scheduledAt?: string; sentRevision?: number; arrivedAt?: string; actualPlaceId?: string;
  sentMessages?: { personId: string; text: string }[];
};
export const personName = (id: string) => people.find(person => person.id === id)?.name ?? "未設定";
export const placeName = (id: string) => places.find(place => place.id === id)?.name ?? "未設定";
export const stamp = (value: string) => value.replace("2026-", "").replaceAll("-", "/").replace("T", " ");
export function previousDay(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}
export function notificationAt(move: Move) {
  if (move.notifyMode === "none") return undefined;
  const date = move.notifyMode === "previous_day" ? previousDay(move.to.date) : move.notifyDate;
  return `${date}T${move.notifyTime}`;
}
function validDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  const parsed = new Date(`${value}:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 16) === value;
}
export function suggestMoves(uses: Use[]): Move[] {
  const ordered = [...uses].sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));
  return ordered.slice(1).flatMap((to, index) => {
    const from = ordered[index];
    // 拠点が不明な場合や同日複数便は自動判断しない。本番では期間の前後も取得する。
    if (!from.placeId || !to.placeId || (from.placeId === to.placeId && from.driverId === to.driverId) || from.date === to.date) return [];
    return [{ id: `move-${from.date}-${to.date}`, vehicleId: sampleVehicle.id, ownerId: "driver-1", from, to,
      fromPlaceId: from.placeId, toPlaceId: to.placeId, assigneeId: "", dueAt: `${to.date}T06:30`,
      notifyMode: "previous_day", notifyDate: previousDay(to.date), notifyTime: "18:00",
      fuel: false, fuelPersonId: "driver-1", note: "", state: "needed", revision: 0,
      notice: "none", noticeKind: "request" }];
  });
}
export function validateMove(move: Move, now: string): string | null {
  if (!people.some(person => person.id === move.assigneeId)) return "担当者を選んでください。";
  if (![move.fromPlaceId, move.toPlaceId].every(id => places.some(place => place.id === id))) return "出発地と届け先を選んでください。";
  if (move.fromPlaceId === move.toPlaceId && move.from.driverId === move.to.driverId) return "同じ場所・同じ利用者です。受け渡しが必要か確認してください。";
  if (!validDateTime(move.dueAt)) return "届ける日時を指定してください。";
  if (move.dueAt <= now) return "届ける期限が過ぎています。日時を確認してください。";
  if (move.dueAt <= `${move.from.date}T${move.from.end}`) return "前の仕事が終わった後に届ける日時を指定してください。";
  if (move.dueAt > `${move.to.date}T${move.to.start}`) return "次の仕事に間に合う日時を指定してください。";
  if (move.fuel && !people.some(person => person.id === move.fuelPersonId)) return "給油する人を選んでください。";
  const at = notificationAt(move);
  if (at && !validDateTime(at)) return "通知する日時を指定してください。";
  if (at && at <= now) return "通知時刻が過ぎています。別の日時を指定してください。";
  if (at && at >= move.dueAt) return "届ける期限より前に通知してください。";
  return null;
}
export function saveMove(draft: Move, previous: Move, now: string): Move {
  const issue = validateMove(draft, now);
  if (issue) throw new Error(issue);
  return { ...draft, revision: previous.revision + 1, state: "planned", noticeKind: previous.sentRevision ? "change" : "request",
    scheduledAt: notificationAt(draft), notice: draft.notifyMode === "none" ? "none" : "scheduled" };
}
export function cancelMove(move: Move, now: string): Move {
  return { ...move, state: "cancelled", revision: move.revision + 1, noticeKind: "cancel",
    scheduledAt: move.sentRevision ? now : undefined, notice: move.sentRevision ? "scheduled" : "none" };
}
export function runNotice(move: Move, now: string, fail = false): Move {
  if (move.notice !== "scheduled" || !move.scheduledAt || move.scheduledAt > now) return move;
  return { ...move, notice: fail ? "failed" : "sent", sentRevision: fail ? move.sentRevision : move.revision,
    sentMessages: fail ? move.sentMessages : messages(move) };
}
export function markArrived(move: Move, placeId: string, at: string): Move {
  if (move.state !== "planned") throw new Error("先に移動を手配してください。");
  if (!places.some(place => place.id === placeId) || !validDateTime(at)) throw new Error("到着場所と日時を入力してください。");
  if (at <= `${move.from.date}T${move.from.end}`) throw new Error("前の仕事が終わった後の日時を入力してください。");
  const complete = placeId === move.toPlaceId;
  return { ...move, state: complete ? "arrived" : "planned", actualPlaceId: placeId, arrivedAt: at,
    notice: complete && (move.notice === "scheduled" || move.notice === "failed") ? "none" : move.notice,
    scheduledAt: complete ? undefined : move.scheduledAt };
}
export function messages(move: Move): { personId: string; text: string }[] {
  const recipients = new Map<string, string[]>();
  const add = (id: string, text: string) => {
    if (!id) return;
    recipients.set(id, [...(recipients.get(id) ?? []), text]);
  };
  if (move.from.driverId !== move.assigneeId) add(move.from.driverId, `${move.from.date.slice(5).replace("-", "/")}の仕事後、${placeName(move.fromPlaceId)}で${personName(move.assigneeId)}さんへ車を引き渡してください。`);
  add(move.assigneeId, move.fromPlaceId === move.toPlaceId
    ? move.assigneeId === move.to.driverId
      ? `${placeName(move.toPlaceId)}で、${stamp(move.dueAt)}までに車を受け取ってください。`
      : `${placeName(move.toPlaceId)}で、${stamp(move.dueAt)}までに${personName(move.to.driverId)}さんへの受け渡しをお願いします。`
    : `${placeName(move.fromPlaceId)}から${placeName(move.toPlaceId)}へ、${stamp(move.dueAt)}までに車を届けてください。`);
  if (move.to.driverId !== move.assigneeId) add(move.to.driverId, `${move.to.date.slice(5).replace("-", "/")}は${placeName(move.toPlaceId)}で受け取ってください。`);
  if (move.to.driverId !== move.ownerId) add(move.to.driverId, "返却時は使用分を給油し、満タンにしてください。返却先は次の移動予定を確認してください。");
  if (move.from.driverId !== move.ownerId && move.to.driverId === move.ownerId) add(move.from.driverId, "返却前に使用分を給油し、満タンにしてください。");
  if (move.fuel) add(move.fuelPersonId, "引き渡し前に満タン給油をお願いします。");
  if (move.ownerId !== move.from.driverId && move.ownerId !== move.to.driverId) add(move.ownerId, `${personName(move.to.driverId)}さんが${move.to.date.slice(5).replace("-", "/")}に利用します。`);
  const output = [...recipients].map(([personId, lines]) => ({ personId, text: move.noticeKind === "cancel"
    ? `車両1201の受け渡し依頼を取り消しました。\n${placeName(move.fromPlaceId)} → ${placeName(move.toPlaceId)}（${stamp(move.dueAt)}）`
    : `${move.noticeKind === "change" ? "【変更】" : ""}車両1201の受け渡し\n${lines.join("\n")}${move.note.trim() ? `\n${move.note.trim()}` : ""}` }));
  for (const previous of move.sentMessages ?? []) {
    if (!recipients.has(previous.personId)) output.push({ personId: previous.personId, text: "車両1201の以前の移動依頼は取り消しました。対応は不要です。" });
  }
  return output;
}
