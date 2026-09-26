// 本番 /admin/shifts/page.tsx と PersonalShiftMemoBoard を架空データで操作する。
import type { PreviewFixture } from "@/lib/preview/fixtureStore";
import type { ReflectGroup, ReflectInput, ReflectPreview } from "@/lib/shiftMemo/reflect";
import { applyBoardChanges, sameBoardValue, type BoardChange } from "@/lib/shiftMemo/sharedBoardSync";

const names = ["佐藤 翔太", "田中 美咲", "鈴木 大輔", "高橋 健太", "伊藤 彩", "渡辺 直樹"];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export type PreviewShift = { id: string; shift_date: string; course_id: string; cycle_no: number; slot: number; driver_id: string | null; vehicle_id?: string | null };
const LIVE_BOARD_KEY = "hakotora_preview_shared_memo_live_v1";
function loadLiveBoard(): { board: Record<string, unknown> | null; revision: number } | null {
  try {
    const raw = localStorage.getItem(LIVE_BOARD_KEY);
    return raw ? JSON.parse(raw) as { board: Record<string, unknown> | null; revision: number } : null;
  } catch { return null; }
}
function createData(scenario: string) {
  const drivers = Array.from({ length: scenario === "large" ? 48 : 6 }, (_, i) => ({ id: id(i + 1), name: names[i % 6], display_name: scenario === "long-name" ? `${names[i % 6]}（配送応援・午前午後兼務）` : null, list_no: i + 1, status: "active", works_as_driver: true, driver_courses: [{ course_id: id(101) }, { course_id: id(102) }] }));
  const courses = [{ id: id(101), name: "豊中サンプル", summary_title: "豊中サンプル", color: "#fbbf24", max_drivers: 4, uses_cycles: true, course_cycles: [{ cycle_no: 1, label: "C1", active: true }, { cycle_no: 2, label: "C2", active: true }] },
    { id: id(102), name: "吹田サンプル", summary_title: "吹田サンプル", color: "#38bdf8", max_drivers: 4, uses_cycles: false, course_cycles: [] }];
  // 曜日の必要人数（共有の基準）。豊中C1だけ埋まっていて、残りは未設定
  const baselines = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({
    course_id: id(101), cycle_no: 1, weekday,
    state: weekday === 0 ? "closed" as const : "working" as const,
    required_count: weekday === 0 ? null : 2,
  }));
  // 未解決一覧の解消期限。既定値のまま置き、設定タブで変更を試せるようにする
  const readinessSettings = { staffingDueDays: 3, confirmationDueDays: 2, dispatchDueDays: 1, horizonDays: 14 };
  // 日付ごとの例外。未確定はこの経路でしか作れないので1件置いておく
  const day = (offset: number) => new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
  type PreviewRequirement = { shift_date: string; course_id: string; cycle_no: number; state: "working" | "closed" | "undecided"; required_count: number | null; note: string };
  const requirements: PreviewRequirement[] = [
    { shift_date: day(3), course_id: id(101), cycle_no: 1, state: "undecided", required_count: null, note: "" },
    { shift_date: day(5), course_id: id(102), cycle_no: 0, state: "working", required_count: 4, note: "" },
  ];
  // 提出締切・便のタブ用。空だと未保存の判定（seeded）が立たない
  const deadlineRules = scenario === "empty" ? [] : [{
    id: "rule-1", name: "標準", sortOrder: 0,
    periods: [
      { seq: 1, startDay: 1, endDay: 15, deadlineMonthOffset: -1, deadlineDay: 25 },
      { seq: 2, startDay: 16, endDay: 31, deadlineMonthOffset: 0, deadlineDay: 10 },
    ],
    overrides: [] as { targetYear: number; targetMonth: number; periodSeq: number; deadlineDate: string; note?: string | null }[],
    driverIds: drivers.slice(0, 2).map(d => d.id),
  }];
  const timeSlots = scenario === "empty" ? [] : [
    { id: "slot-1", name: "午前", startTime: "08:00", endTime: "12:00", sortOrder: 0, active: true, driverIds: drivers.slice(0, 1).map(d => d.id) },
    { id: "slot-2", name: "午後", startTime: "13:00", endTime: "18:00", sortOrder: 1, active: true, driverIds: [] as string[] },
  ];
  // 出力（シフト表の画像）でナンバープレートを確かめるための架空車両。
  // 実在の番号はコピーしない。色は4種を1台ずつ入れて塗り分けを見る。
  const vehicles = scenario === "empty" ? [] : [
    { id: id(201), plate_color: "black", number_prefix: "京都", number_class: "480", number_hiragana: "り", number_numeric: "12-34", manufacturer: "サンプル", brand: "バン", is_disposed: false, is_unavailable: false },
    { id: id(202), plate_color: "yellow", number_prefix: "大阪", number_class: "580", number_hiragana: "わ", number_numeric: "56-78", manufacturer: "サンプル", brand: "軽バン", is_disposed: false, is_unavailable: false },
    { id: id(203), plate_color: "white", number_prefix: "なにわ", number_class: "400", number_hiragana: "あ", number_numeric: "9-01", manufacturer: "サンプル", brand: "トラック", is_disposed: false, is_unavailable: false },
    { id: id(204), plate_color: "green", number_prefix: "神戸", number_class: "100", number_hiragana: "か", number_numeric: "2-345", manufacturer: "サンプル", brand: "中型", is_disposed: false, is_unavailable: false },
  ];
  // 契約区分（月額リース/日額リース/リースなし）。出力の絞り込みで使うので3種そろえる。
  const driverLeases = scenario === "empty" ? [] : drivers.slice(0, 4).map((driver, i) => ({
    id: `lease-${i}`,
    driver_id: driver.id,
    mode: (i % 2 === 0 ? "MONTHLY" : "DAILY") as "MONTHLY" | "DAILY",
    valid_from: "2026-01-01",
    valid_to: null as string | null,
  }));
  return { courses, drivers: scenario === "empty" ? [] : drivers, vehicles, driverLeases, shifts: [] as PreviewShift[], baselines, requirements, readinessSettings, deadlineRules, timeSlots, seeded: new Set<string>(), revision: 0,
    sharedBoard: null as Record<string, unknown> | null, sharedRevision: 0, sharedFailed: false };
}
export type ShiftsFixtureState = ReturnType<typeof createData>;

export function reflectPreview(state: Pick<ShiftsFixtureState, "shifts" | "revision">, input: ReflectInput): ReflectPreview {
  const changes = input.groups.map(group => {
    const before = state.shifts.filter(s => s.shift_date === group.date && s.course_id === group.courseId && s.cycle_no === group.cycleNo && s.driver_id).map(s => s.driver_id!);
    return { ...group, addIds: group.driverIds.filter(id => !before.includes(id)), removeIds: input.mode === "replace" ? before.filter(id => !group.driverIds.includes(id)) : [], keepIds: before.filter(id => input.mode === "add" || group.driverIds.includes(id)) };
  });
  let hash = 0;
  for (const c of JSON.stringify([input, state.shifts, state.revision])) hash = Math.imul(31, hash) + c.charCodeAt(0) | 0;
  return { revision: (hash >>> 0).toString(16).padStart(32, "0"), changes, warnings: [], added: changes.reduce((sum, c) => sum + c.addIds.length, 0), removed: changes.reduce((sum, c) => sum + c.removeIds.length, 0), kept: changes.reduce((sum, c) => sum + c.keepIds.length, 0), applied: false };
}

// 未解決一覧（/api/admin/shifts/readiness）。readiness シナリオだけ中身を返す。
// 期限切れ・要対応・軽い指摘が同時に並んだ状態を作り、並びと色分けを確認できるようにする。
const dayFrom = (offset: number) => new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);

function readinessResponse(state: ShiftsFixtureState, scenario: string) {
  const today = dayFrom(0);
  const base = { courseNames: { [state.courses[0].id]: state.courses[0].name, [state.courses[1].id]: state.courses[1].name },
    cycleLabels: { [`${state.courses[0].id}|1`]: "C1", [`${state.courses[0].id}|2`]: "C2" },
    driverNames: Object.fromEntries(state.drivers.slice(0, 3).map(d => [d.id, d.display_name || d.name])),
    dates: [0, 1, 2, 3, 4].map(dayFrom), today, unavailable: false };
  const course = state.courses[0].id, other = state.courses[1].id;
  const driver = state.drivers[0]?.id ?? null, driver2 = state.drivers[1]?.id ?? null;
  // 期限切れも要対応も無い状態。黄系の見た目と「未解決 N件」だけの要約を確認する
  if (scenario === "readiness-light") {
    return { ...base, items: [
      { kind: "baseline_missing", date: null, courseId: other, cycleNo: 0, driverId: null, dueDate: null, severity: "medium", detail: "必要人数の基準が未設定" },
      { kind: "no_vehicle", date: dayFrom(4), courseId: course, cycleNo: 1, driverId: driver, dueDate: dayFrom(3), severity: "medium", detail: "車両が未割当" },
    ] };
  }
  // 件数が増えたときの高さ・折り返し。長いコース名と表示名を混ぜる
  if (scenario === "readiness-many") {
    const longNames = { ...base.courseNames, [course]: "豊中サンプル第一配送センター（午前便・応援あり）" };
    const items = Array.from({ length: 40 }, (_, i) => ({
      kind: i % 3 === 0 ? "shortage" : i % 3 === 1 ? "unconfirmed" : "no_vehicle",
      date: dayFrom(1 + (i % 10)),
      courseId: i % 3 === 2 ? other : course,
      cycleNo: i % 3 === 2 ? 0 : 1,
      driverId: i % 3 === 1 ? driver : null,
      dueDate: dayFrom(i % 10 - 2),
      severity: i % 3 === 0 ? "high" : "medium",
      detail: i % 3 === 0 ? "3人必要・1人配置" : i % 3 === 1 ? "本人未確認" : "車両が未割当",
    }));
    return { ...base, courseNames: longNames, items };
  }
  if (scenario !== "readiness") return { ...base, items: [] };
  return { ...base, items: [
    // 期限を過ぎたもの（当日まで残っている＝赤で出る）
    { kind: "shortage", date: dayFrom(1), courseId: course, cycleNo: 1, driverId: null, dueDate: dayFrom(-2), severity: "high", detail: "2人必要・0人配置" },
    { kind: "unconfirmed", date: dayFrom(1), courseId: null, cycleNo: null, driverId: driver, dueDate: dayFrom(-1), severity: "medium", detail: "本人未確認" },
    { kind: "unavailable", date: dayFrom(2), courseId: null, cycleNo: null, driverId: driver2, dueDate: dayFrom(0), severity: "high", detail: "本人が対応不可" },
    { kind: "source_mismatch", date: dayFrom(3), courseId: course, cycleNo: 2, driverId: driver, dueDate: dayFrom(0), severity: "high", detail: "原本にあって未配置 1人・原本に無い配置 1人" },
    { kind: "stale_confirmation", date: dayFrom(3), courseId: null, cycleNo: null, driverId: driver2, dueDate: dayFrom(1), severity: "high", detail: "確認後に予定が変わった" },
    { kind: "undecided", date: dayFrom(4), courseId: other, cycleNo: 0, driverId: null, dueDate: dayFrom(1), severity: "high", detail: "必要人数が未確定" },
    { kind: "no_vehicle", date: dayFrom(4), courseId: course, cycleNo: 1, driverId: driver, dueDate: dayFrom(3), severity: "medium", detail: "車両が未割当" },
    // 枠そのものの設定漏れ（日付を持たない）
    { kind: "baseline_missing", date: null, courseId: other, cycleNo: 0, driverId: null, dueDate: null, severity: "medium", detail: "必要人数の基準が未設定" },
  ] };
}

export const shiftsFixture: PreviewFixture<ShiftsFixtureState> = {
  id: "shifts", title: "シフト・シフトメモ", pathname: "/admin/shifts",
  scenarios: { normal: { label: "通常", description: "個人・共有メモを切り替え" }, empty: { label: "未設定", description: "ドライバー・配置なし" }, "long-name": { label: "長い名前", description: "長い名前の配置" }, large: { label: "多数", description: "48人の名簿" }, conflict: { label: "同時変更", description: "セル編集とメモ反映の両方で後勝ちを止める" }, "shared-live": { label: "2タブ共同", description: "別タブとの参加・更新を試す" }, "shared-peers": { label: "共同編集者", description: "共有メモの参加者表示" }, "shared-disjoint": { label: "別の箇所", description: "他の人の変更も残す" }, "shared-conflict": { label: "共有メモ競合", description: "同じ箇所の変更を検出" }, "shared-save-error": { label: "共有メモ保存失敗", description: "保存失敗から再試行" }, "save-error": { label: "反映失敗", description: "最初の反映で失敗し、再確認後に成功" }, unmapped: { label: "名前の対応", description: "未登録の名前札を登録ドライバーに合わせる" }, readiness: { label: "未解決あり", description: "不足・未確認・原本不一致・期限切れの一覧" }, "readiness-light": { label: "未解決（期限内）", description: "期限切れなし・基準未設定だけの状態" }, "readiness-many": { label: "未解決が多数", description: "40件・長いコース名で高さと折り返しを見る" } },
  createState: ({ scenario, driver }) => {
    // 本番利用者の保存キーには触れない。シナリオを開くたびに架空メモを初期化する。
    if (typeof localStorage !== "undefined") localStorage.removeItem(`hakotora_personal_shift_memo_v1:${driver.id}`);
    return createData(scenario);
  },
  onReset: ({ scenario }) => {
    if (scenario === "shared-live") localStorage.removeItem(LIVE_BOARD_KEY);
  },
  read(state, { path, params }, { driver, scenario }) {
    if (path === "/api/admin/shifts/memo/board") {
      if (scenario === "shared-live") {
        const live = loadLiveBoard();
        if (live) { state.sharedBoard = live.board; state.sharedRevision = live.revision; }
      }
      return { board: state.sharedBoard, revision: state.sharedRevision };
    }
    if (path === "/api/admin/invoice-addresses") return { addresses: [] };
    if (path === "/api/admin/shifts/pending-changes") return { enabled: false, changes: [], canSend: false };
    if (path === "/api/admin/shifts/readiness") return readinessResponse(state, scenario);
    // 提出締切・便（時間帯）タブ。fixture が無いと「プレビュー対象外」になり、
    // 未保存確認などの動作をこの画面で確認できない
    if (path === "/api/admin/shift-deadlines") {
      return { rules: state.deadlineRules, drivers: state.drivers.map(d => ({ id: d.id, name: d.name, display_name: d.display_name })) };
    }
    if (path === "/api/admin/shift-slots") {
      return { slots: state.timeSlots, drivers: state.drivers.map(d => ({ id: d.id, name: d.name, display_name: d.display_name })) };
    }
    if (path === "/api/admin/shifts/readiness-settings") {
      return { settings: state.readinessSettings, defaults: { staffingDueDays: 3, confirmationDueDays: 2, dispatchDueDays: 1, horizonDays: 14 } };
    }
    if (path === "/api/admin/shifts/requirements") {
      if (scenario === "empty") return { baselines: [], requirements: [], unavailable: true };
      return { baselines: state.baselines, requirements: state.requirements, unavailable: false };
    }
    if (path === "/api/admin/spot-jobs") return { jobs: [] };
    if (path !== "/api/admin/shifts") return undefined;
    const start = params.get("start")!, end = params.get("end")!;
    if (!state.seeded.has(start) && start && end) {
      state.seeded.add(start);
      const assignments: Record<string, unknown[]> = {};
      const lanes = state.courses.flatMap(course => (course.uses_cycles ? [1, 2] : [0]).map(cycle => ({ id: `base-${course.id}${cycle ? `-${cycle}` : ""}`, routeId: course.id, name: cycle ? `C${cycle}` : course.name, color: course.color, activeWeekdays: [0, 1, 2, 3, 4, 5, 6], requiredCount: 2, custom: false })));
      for (let date = new Date(`${start}T12:00:00Z`); date.toISOString().slice(0, 10) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
        const day = date.toISOString().slice(0, 10);
        if (scenario === "empty") continue;
        for (const lane of lanes) {
          const cycle = lane.id.endsWith("-2") ? 2 : lane.id.endsWith("-1") ? 1 : 0;
          const chosen = lane.routeId === state.courses[0].id ? state.drivers.slice(0, 2) : state.drivers.slice(3, 4);
          assignments[`${lane.id}|${day}`] = chosen.map(person => ({ placementId: `${lane.id}-${day}-${person.id}`, personKey: person.id, driverId: person.id, name: person.display_name || person.name }));
          const assignedDriverId = lane.routeId === state.courses[0].id ? state.drivers[2].id : state.drivers[3].id;
          // 車両は日付とレーンで回して、4色のプレートが一覧に混ざるようにする
          const vehicle = state.vehicles.length
            ? state.vehicles[(date.getUTCDate() + lanes.indexOf(lane)) % state.vehicles.length]
            : null;
          state.shifts.push({ id: `${day}-${lane.id}`, shift_date: day, course_id: lane.routeId, cycle_no: cycle, slot: 1, driver_id: assignedDriverId, vehicle_id: vehicle?.id ?? null });
        }
      }
      if (scenario === "unmapped") assignments[`${lanes[0].id}|${start}`] = [{ placementId: "extra", personKey: "custom:応援", name: "応援" }];
      if (typeof localStorage !== "undefined") {
        const key = `hakotora_personal_shift_memo_v1:${driver.id}`;
        const old = JSON.parse(localStorage.getItem(key) ?? "{}");
        localStorage.setItem(key, JSON.stringify({ version: 1, lanes, laneOrder: lanes.map(lane => lane.id), hiddenLaneIds: [], assignments: { ...old.assignments, ...assignments }, extraPeople: [], notes: {} }));
      }
    }
    return { courses: state.courses, drivers: state.drivers, shifts: state.shifts.filter(s => s.shift_date >= start && s.shift_date <= end), requests: [], slots: [], vehicles: state.vehicles, vehicle_driver_links: [], vehicle_loans: [], recent_assignments: [], driver_leases: state.driverLeases };
  },
  write(state, { path, body }, { role, scenario }) {
    if (path === "/api/admin/shifts/memo/board") {
      if (role !== "admin") throw new Error("この操作の権限がありません。");
      if (scenario === "shared-live") {
        const live = loadLiveBoard();
        if (live) { state.sharedBoard = live.board; state.sharedRevision = live.revision; }
      }
      const changes = body.changes as BoardChange[];
      if (!Array.isArray(changes) || changes.length === 0) throw new Error("変更内容を確認してください");
      state.sharedBoard ??= body.initialBoard as Record<string, unknown>;
      if (scenario === "shared-save-error" && !state.sharedFailed) {
        state.sharedFailed = true;
        throw new Error("共有メモを保存できませんでした");
      }
      if (scenario === "shared-conflict" && !state.sharedFailed) {
        state.sharedFailed = true;
        const first = changes[0];
        state.sharedBoard = applyBoardChanges(state.sharedBoard, [{ ...first, value: first.field === "notes" ? "他の人のメモ" : [] }]);
        state.sharedRevision++;
      }
      if (scenario === "shared-disjoint" && !state.sharedFailed) {
        state.sharedFailed = true;
        state.sharedBoard = applyBoardChanges(state.sharedBoard, [{ field: "notes", key: "2026-09-25", expected: null, value: "他の担当者のメモ" }]);
        state.sharedRevision++;
      }
      for (const change of changes) {
        const current = change.key === undefined ? state.sharedBoard[change.field] : ((state.sharedBoard[change.field] ?? {}) as Record<string, unknown>)[change.key];
        if (!sameBoardValue(current, change.expected)) throw new Error("同じ箇所を他の人が更新しました。最新の内容を確認してください");
      }
      state.sharedBoard = applyBoardChanges(state.sharedBoard, changes);
      state.sharedRevision++;
      if (scenario === "shared-live") localStorage.setItem(LIVE_BOARD_KEY, JSON.stringify({ board: state.sharedBoard, revision: state.sharedRevision }));
      return { revision: state.sharedRevision, board: state.sharedBoard };
    }
    // シフト表のセル1つの割当。O-3 の競合検知（409）をプレビューでも試せるようにする
    if (path === "/api/admin/shifts") {
      if (role !== "admin") throw new Error("この操作の権限がありません。");
      const { shiftDate, courseId, cycleNo = 0, slot, driverId, expectedDriverId, hasExpectation } = body as {
        shiftDate: string; courseId: string; cycleNo?: number; slot: number;
        driverId: string | null; expectedDriverId?: string | null; hasExpectation?: boolean;
      };
      const same = (row: PreviewShift) => row.shift_date === shiftDate && row.course_id === courseId && row.cycle_no === cycleNo && row.slot === slot;
      const existing = state.shifts.find(same);
      const current = existing?.driver_id ?? null;
      // conflict シナリオでは「他の人が先に変えた」状態を1回だけ作る
      if (scenario === "conflict" && state.revision === 0 && hasExpectation) {
        state.revision++;
        throw new Error("別の変更が保存されています。最新の状態を確認してください。");
      }
      if (hasExpectation && current !== (expectedDriverId ?? null)) {
        throw new Error("別の変更が保存されています。最新の状態を確認してください。");
      }
      if (existing) {
        existing.driver_id = driverId;
        if (!driverId) existing.vehicle_id = null;
      } else {
        state.shifts.push({ id: `cell-${shiftDate}-${courseId}-${cycleNo}-${slot}`, shift_date: shiftDate, course_id: courseId, cycle_no: cycleNo, slot, driver_id: driverId });
      }
      return { shift: state.shifts.find(same) };
    }

    if (path === "/api/admin/shifts/readiness-settings") {
      if (role !== "admin") throw new Error("この操作の権限がありません。");
      const next = body as typeof state.readinessSettings;
      const longest = Math.max(next.staffingDueDays, next.confirmationDueDays, next.dispatchDueDays);
      if (next.horizonDays < longest) throw new Error(`先読みは一番長い期限（${longest}日前）以上にしてください`);
      state.readinessSettings = next;
      return { ok: true, settings: next };
    }
    if (path === "/api/admin/shift-deadlines" || path === "/api/admin/shift-slots") {
      if (role !== "admin") throw new Error("この操作の権限がありません。");
      return { ok: true };
    }
    if (path === "/api/admin/shifts/requirements") {
      if (role !== "admin") throw new Error("この操作の権限がありません。");
      for (const change of (body.requirements ?? []) as { date: string; courseId: string; cycleNo: number; state: string | null; requiredCount: number | null }[]) {
        state.requirements = state.requirements.filter(r => !(r.shift_date === change.date && r.course_id === change.courseId && r.cycle_no === change.cycleNo));
        if (change.state) state.requirements.push({ shift_date: change.date, course_id: change.courseId, cycle_no: change.cycleNo, state: change.state as "working" | "closed" | "undecided", required_count: change.requiredCount, note: "" });
      }
      for (const change of (body.baselines ?? []) as { courseId: string; cycleNo: number; weekday: number; state: string | null; requiredCount: number | null }[]) {
        state.baselines = state.baselines.filter(b => !(b.course_id === change.courseId && b.cycle_no === change.cycleNo && b.weekday === change.weekday));
        if (change.state) state.baselines.push({ course_id: change.courseId, cycle_no: change.cycleNo, weekday: change.weekday, state: change.state as "working" | "closed", required_count: change.requiredCount });
      }
      return { ok: true };
    }
    if (path !== "/api/admin/shifts/memo/reflect") return undefined;
    if (role !== "admin") throw new Error("この操作の権限がありません。");
    const input = { mode: body.mode as ReflectInput["mode"], groups: body.groups as ReflectGroup[] };
    const result = reflectPreview(state, input);
    if (body.action === "preview") return result;
    if (scenario === "save-error" && state.revision === 0) { state.revision++; throw new Error("反映できませんでした。入力は残っています。変更内容を確認し直してください。"); }
    if (scenario === "conflict" && state.revision === 0) state.revision++;
    if (body.revision !== reflectPreview(state, input).revision) throw new Error("別の変更が保存されています。変更内容を確認し直してください。");
    for (const change of result.changes) {
      const same = (s: PreviewShift) => s.shift_date === change.date && s.course_id === change.courseId && s.cycle_no === change.cycleNo;
      state.shifts = state.shifts.map(s => same(s) && s.driver_id && change.removeIds.includes(s.driver_id) ? { ...s, driver_id: null, vehicle_id: null } : s);
      for (const driverId of change.addIds) {
        const slot = Math.max(0, ...state.shifts.filter(same).map(s => s.slot)) + 1;
        state.shifts.push({ id: `memo-${state.revision}-${change.date}-${change.courseId}-${change.cycleNo}-${slot}`, shift_date: change.date, course_id: change.courseId, cycle_no: change.cycleNo, slot, driver_id: driverId });
      }
    }
    state.revision++;
    return { ...result, applied: true };
  },
};
