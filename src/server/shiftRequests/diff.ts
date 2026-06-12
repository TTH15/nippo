// ============================================================
// 希望休の差分計算・履歴要約（純TS・DB非依存）。
//   提出時に「全削除→再挿入」ではなく差分を取ることで、
//   変更されていない行の created_at を保持し、ログを実変更分だけに絞る。
// ============================================================

/** (date, slotId) で識別する希望休エントリ。slotId=null は全休。 */
export type ReqKey = { request_date: string; slot_id: string | null };

/** 既存行（id 付き）。削除対象の特定に使う。 */
export type ExistingReq = ReqKey & { id: string };

const keyOf = (r: ReqKey): string => `${r.request_date}#${r.slot_id ?? "ALL"}`;

export type ReqDiff = {
  /** 新規に追加すべきエントリ（desired にあって existing にない） */
  toAdd: ReqKey[];
  /** 削除すべき既存行（existing にあって desired にない） */
  toRemove: ExistingReq[];
};

/**
 * 既存と希望(desired)を比較し、追加・削除すべき差分を返す。
 * 同じ (date, slot) は変更なしとして触らない（created_at 保持）。
 */
export function diffShiftRequests(existing: ExistingReq[], desired: ReqKey[]): ReqDiff {
  const existingByKey = new Map<string, ExistingReq>();
  for (const e of existing) existingByKey.set(keyOf(e), e);

  const desiredKeys = new Set<string>();
  const toAdd: ReqKey[] = [];
  for (const d of desired) {
    const k = keyOf(d);
    if (desiredKeys.has(k)) continue; // desired 内の重複は無視
    desiredKeys.add(k);
    if (!existingByKey.has(k)) toAdd.push({ request_date: d.request_date, slot_id: d.slot_id });
  }

  const toRemove: ExistingReq[] = [];
  for (const e of existing) {
    if (!desiredKeys.has(keyOf(e))) toRemove.push(e);
  }

  return { toAdd, toRemove };
}

// ---- 履歴要約（運営UIの「初回提出 / 最終変更」最小表示用） ----

export type ShiftLog = {
  action: "add" | "remove";
  actor_type: "driver" | "admin";
  actor_name: string | null;
  created_at: string; // ISO
};

export type HistorySummary = {
  /** 最古の 'add'（＝初回に希望休が出された日時）。一度も add が無ければ null。 */
  firstSubmittedAt: string | null;
  /** 最新イベントの日時。ログが無ければ null。 */
  lastChangedAt: string | null;
  /** 最新イベントの操作者名。 */
  lastActorName: string | null;
  /** 最新イベントの操作者種別。 */
  lastActorType: "driver" | "admin" | null;
  /** 変更が一度でも起きたか（add の後に remove や再 add 等、2件以上）。 */
  changed: boolean;
};

/**
 * (driver, date) のログ配列から初回提出・最終変更を要約する。
 * 入力順は不問（内部で created_at により判定）。
 */
export function summarizeHistory(logs: ShiftLog[]): HistorySummary {
  if (logs.length === 0) {
    return { firstSubmittedAt: null, lastChangedAt: null, lastActorName: null, lastActorType: null, changed: false };
  }
  let firstAdd: ShiftLog | null = null;
  let last: ShiftLog = logs[0];
  for (const l of logs) {
    if (l.action === "add" && (firstAdd === null || l.created_at < firstAdd.created_at)) firstAdd = l;
    if (l.created_at > last.created_at) last = l;
  }
  return {
    firstSubmittedAt: firstAdd?.created_at ?? null,
    lastChangedAt: last.created_at,
    lastActorName: last.actor_name,
    lastActorType: last.actor_type,
    changed: logs.length > 1,
  };
}
