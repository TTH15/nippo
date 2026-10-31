// 共有メモの保存単位。盤面全体の版番号ではなく、変更した項目だけを比較する。
export const BOARD_MAP_FIELDS = ["assignments", "notes", "dayOverrides", "requiredCountOverrides", "hiddenPeople", "backgroundColors"] as const;
export const BOARD_VALUE_FIELDS = ["lanes", "laneOrder", "hiddenLaneIds", "routeOrder", "hiddenRouteIds", "extraPeople", "widths"] as const;
export type BoardChange = { field: string; key?: string; expected: unknown; value: unknown };
export type Board = Record<string, unknown>;

/** 候補だけを隠す。配置済みの札と正式なシフトは変更しない。 */
export function readHiddenPeople(value: unknown): Record<string, true> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, hidden]) =>
    hidden === true && key.length <= 200 && /^(driver|custom):.+$/.test(key),
  )) as Record<string, true>;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]),
  );
  return value ?? null;
}

export const sameBoardValue = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function boardChanges(base: Board, next: Board): BoardChange[] {
  const changes: BoardChange[] = [];
  for (const field of BOARD_VALUE_FIELDS) {
    if (!sameBoardValue(base[field], next[field])) changes.push({ field, expected: base[field] ?? null, value: next[field] ?? null });
  }
  for (const field of BOARD_MAP_FIELDS) {
    const before = (base[field] ?? {}) as Record<string, unknown>;
    const after = (next[field] ?? {}) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!sameBoardValue(before[key], after[key])) changes.push({ field, key, expected: before[key] ?? null, value: after[key] ?? null });
    }
  }
  return changes;
}

export function applyBoardChanges(board: Board, changes: BoardChange[]): Board {
  const next = { ...board };
  for (const { field, key, value } of changes) {
    if (key === undefined) {
      if (value === null) delete next[field];
      else next[field] = value;
    } else {
      const map = { ...((next[field] ?? {}) as Record<string, unknown>) };
      if (value === null) delete map[key];
      else map[key] = value;
      next[field] = map;
    }
  }
  return next;
}

export function mergeBoardChanges(base: Board, local: Board, remote: Board) {
  const changes = boardChanges(base, local);
  const conflicts = changes.filter(({ field, key, expected, value }) => {
    const current = key === undefined ? remote[field] : ((remote[field] ?? {}) as Record<string, unknown>)[key];
    return !sameBoardValue(current, expected) && !sameBoardValue(current, value);
  });
  // 競合中もローカルの意図を保持する。呼び出し側は競合がある間、バッチ全体を保存しない。
  return { board: applyBoardChanges(remote, changes), conflicts };
}

/** 一つの入場世代の正本・編集値・送信値。通信とReactの描画から独立して扱う。 */
export class SharedBoardSession {
  revision = -1;
  canonical: Board;
  local: Board;
  conflicts: BoardChange[] = [];
  flight: { snapshot: Board; changes: BoardChange[] } | null = null;
  uncertain = false;
  ready = false;

  constructor(initial: Board) { this.canonical = initial; this.local = initial; }

  private intentBase() {
    // 正本を進めても未解決の競合のexpectedを忘れない。
    return applyBoardChanges(this.canonical, this.conflicts.map(change => ({ ...change, value: change.expected })));
  }

  edit(board: Board) {
    const base = this.intentBase();
    this.local = board;
    this.conflicts = mergeBoardChanges(base, board, this.canonical).conflicts;
  }

  accept(board: Board | null, revision: number, acknowledged?: Board) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("共有メモの版を確認できませんでした");
    if (revision < this.revision && !acknowledged) return false;
    if (!this.ready) {
      const merged = mergeBoardChanges(this.canonical, this.local, board ?? this.canonical);
      this.canonical = board ?? this.canonical;
      this.local = merged.board;
      this.conflicts = merged.conflicts;
      this.revision = revision;
      this.ready = true;
      return true;
    }
    let base = acknowledged ?? this.intentBase();
    // 応答を失っていても、送信した変更すべてが正本にあれば確定済み。
    if (!acknowledged && this.flight && this.flight.changes.every(change => {
      const value = change.key === undefined ? board?.[change.field]
        : ((board?.[change.field] ?? {}) as Board)[change.key];
      return sameBoardValue(value, change.value);
    })) base = this.flight.snapshot;
    if (revision >= this.revision) {
      this.canonical = board ?? this.canonical;
      this.revision = revision;
    }
    const merged = mergeBoardChanges(base, this.local, this.canonical);
    this.local = merged.board;
    this.conflicts = merged.conflicts;
    return true;
  }

  get changes() { return boardChanges(this.canonical, this.local); }
  get pending() { return !!this.flight || this.uncertain || this.conflicts.length > 0 || this.changes.length > 0; }

  startSave() {
    if (!this.ready || this.flight || this.uncertain || this.conflicts.length || !this.changes.length) return null;
    this.flight = { snapshot: this.local, changes: this.changes };
    return this.flight;
  }

  resolve(useLocal: boolean) {
    // 人員移動など複数セルの変更をひとまとまりとして解決する。
    if (!useLocal) this.local = this.canonical;
    this.conflicts = [];
  }
}
