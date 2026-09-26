// 共有メモの保存単位。盤面全体の版番号ではなく、変更した項目だけを比較する。
export const BOARD_MAP_FIELDS = ["assignments", "notes", "dayOverrides", "requiredCountOverrides"] as const;
export const BOARD_VALUE_FIELDS = ["lanes", "laneOrder", "hiddenLaneIds", "routeOrder", "hiddenRouteIds", "extraPeople", "widths"] as const;
export type BoardChange = { field: string; key?: string; expected: unknown; value: unknown };
type Board = Record<string, unknown>;

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
  const conflicts = changes.filter(({ field, key, expected }) => {
    const current = key === undefined ? remote[field] : ((remote[field] ?? {}) as Record<string, unknown>)[key];
    return !sameBoardValue(current, expected);
  });
  return { board: applyBoardChanges(remote, changes.filter((change) => !conflicts.includes(change))), conflicts };
}
