import type { ShiftMemoBoardData, TransferLane, TransferPerson } from "./transfer";

export type ImageMemoRow = { name: string; days: { day: number; names: string[] }[] };
export type ImageMemoRead = {
  period: { year: number; month: number };
  rows: ImageMemoRow[];
  warnings: string[];
};
export type ImageMemoCourse = { id: string; name: string; summary_title?: string | null; color: string };
export type ImageMemoDriver = { id: string; name: string; display_name?: string | null };

const normalize = (value: string) => value.normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();

/** AIの候補は保存前に端末側でも検査する。年月が違うファイルは読み込まない。 */
export function parseImageMemoRead(value: unknown, expected: { year: number; month: number }): ImageMemoRead {
  if (!value || typeof value !== "object") throw new Error("読み取り結果を確認できませんでした");
  const raw = value as Partial<ImageMemoRead>;
  if (!raw.period || raw.period.year !== expected.year || raw.period.month !== expected.month) {
    throw new Error(`画像の年月が${expected.year}年${expected.month}月と一致しません`);
  }
  if (!Array.isArray(raw.rows) || raw.rows.length === 0 || raw.rows.length > 200 ||
    !Array.isArray(raw.warnings) || raw.warnings.some(item => typeof item !== "string")) {
    throw new Error("担当枠を読み取れませんでした");
  }
  let placementCount = 0;
  const rows = raw.rows.map(row => {
    if (!row || typeof row.name !== "string" || !row.name.trim() || row.name.length > 100 || !Array.isArray(row.days)) {
      throw new Error("担当枠の読み取り結果が壊れています");
    }
    const seen = new Set<number>();
    const days = row.days.map(day => {
      if (!day || !Number.isInteger(day.day) || day.day < 1 ||
        day.day > new Date(expected.year, expected.month, 0).getDate() || seen.has(day.day) ||
        !Array.isArray(day.names) || day.names.length === 0 || day.names.some(name => typeof name !== "string" || !name.trim() || name.length > 80)) {
        throw new Error("日付と名前の読み取り結果が壊れています");
      }
      seen.add(day.day);
      placementCount += day.names.length;
      if (placementCount > 10000) throw new Error("名前札が多すぎます");
      return { day: day.day, names: day.names.map(name => name.trim()) };
    });
    return { name: row.name.trim(), days };
  });
  const placedRows = rows.filter(row => row.days.length > 0);
  if (placedRows.length === 0) throw new Error("日付を読み取れませんでした");
  return { period: raw.period, rows: placedRows, warnings: raw.warnings };
}

/** 一致する既存枠が一つなら使い、それ以外は同名の登録コースに新しい枠を作る。 */
export function imageRowDefaultTarget(name: string, lanes: TransferLane[], courses: ImageMemoCourse[]): string {
  const matches = lanes.filter(lane => normalize(lane.name) === normalize(name));
  if (matches.length === 1) return `lane:${matches[0].id}`;
  const routes = courses.filter(course => [course.name, course.summary_title ?? ""].some(label => normalize(label) === normalize(name)));
  return routes.length === 1 ? `course:${routes[0].id}` : "";
}

export function mergeImageMemoRead(
  board: ShiftMemoBoardData,
  read: ImageMemoRead,
  targets: string[],
  courses: ImageMemoCourse[],
  drivers: ImageMemoDriver[],
): ShiftMemoBoardData {
  if (targets.length !== read.rows.length) throw new Error("担当枠の反映先を選び直してください");
  if (targets.every(target => target === "skip")) throw new Error("読み込む担当枠を選んでください");
  const lanes = [...board.lanes];
  const laneOrder = [...board.laneOrder];
  const assignments = { ...board.assignments };
  const extraPeople = new Set(board.extraPeople);
  const occupied = new Set<string>();
  read.rows.forEach((row, index) => {
    const target = targets[index];
    if (target === "skip") return;
    let lane: TransferLane | undefined;
    if (target.startsWith("lane:")) lane = lanes.find(candidate => candidate.id === target.slice(5));
    if (target.startsWith("course:")) {
      const course = courses.find(candidate => candidate.id === target.slice(7));
      if (course) {
        const id = `import-${crypto.randomUUID()}`;
        lane = { id, routeId: course.id, name: row.name, color: course.color || "#94a3b8",
          activeWeekdays: [0, 1, 2, 3, 4, 5, 6], requiredCount: Math.max(1, ...row.days.map(day => day.names.length)),
          custom: true, reflectCourseId: course.id };
        lanes.push(lane);
        laneOrder.push(id);
      }
    }
    if (!lane) throw new Error(`「${row.name}」の反映先を選んでください`);
    for (const day of row.days) {
      const date = `${read.period.year}-${String(read.period.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
      const key = `${lane.id}|${date}`;
      if (occupied.has(key)) throw new Error(`「${row.name}」の読み込み先と日付が重複しています`);
      occupied.add(key);
      assignments[key] = day.names.map((name): TransferPerson => {
        const matches = drivers.filter(driver => [driver.name, driver.display_name ?? ""].some(label => normalize(label) === normalize(name)));
        const driver = matches.length === 1 ? matches[0] : undefined;
        if (!driver) extraPeople.add(name);
        return { placementId: `import-${crypto.randomUUID()}`, personKey: driver ? `driver:${driver.id}` : `custom:${name}`,
          ...(driver ? { driverId: driver.id } : {}), name };
      });
    }
  });
  return { ...board, lanes, laneOrder, assignments, extraPeople: [...extraPeople] };
}
