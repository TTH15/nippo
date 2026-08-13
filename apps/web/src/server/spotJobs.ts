// 単発案件（spot_jobs）の共有バリデーション・シリアライズ。
// 設計: docs/design/work-model.md §3。金額は参考値のみ（確定・締めには乗せない）。
import { supabase } from "@/server/db/client";

export const SPOT_JOB_STATUSES = ["planned", "done", "cancelled"] as const;
export type SpotJobStatus = (typeof SPOT_JOB_STATUSES)[number];

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const SPOT_JOB_COLUMNS =
  "id, title, job_date, meeting_place, meeting_time, end_time, client_name, billing_amount, note, status, created_at";

type SpotJobRow = {
  id: string;
  title: string;
  job_date: string;
  meeting_place: string | null;
  meeting_time: string | null;
  end_time: string | null;
  client_name: string | null;
  billing_amount: number | null;
  note: string | null;
  status: string;
  created_at: string;
};

type MemberRow = {
  id: string;
  job_id: string;
  driver_id: string | null;
  display_name: string | null;
  pay_amount: number | null;
};

/** PG の time は "HH:MM:SS" で返る。UI（TimePicker）は "HH:MM"。 */
function trimTime(v: string | null): string | null {
  return v ? v.slice(0, 5) : null;
}

export function serializeSpotJob(row: SpotJobRow, members: MemberRow[]) {
  return {
    id: row.id,
    title: row.title,
    jobDate: row.job_date,
    meetingPlace: row.meeting_place,
    meetingTime: trimTime(row.meeting_time),
    endTime: trimTime(row.end_time),
    clientName: row.client_name,
    billingAmount: row.billing_amount,
    note: row.note,
    status: row.status,
    members: members.map((m) => ({
      id: m.id,
      driverId: m.driver_id,
      displayName: m.display_name,
      payAmount: m.pay_amount,
    })),
  };
}

export type SerializedSpotJob = ReturnType<typeof serializeSpotJob>;

/** "HH:MM" のみ許可。null/"" = クリア、undefined = 指定なし。不正は false。 */
export function normalizeTime(v: unknown): { ok: true; value: string | null | undefined } | { ok: false } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null || v === "") return { ok: true, value: null };
  if (typeof v === "string" && TIME_RE.test(v)) return { ok: true, value: v.slice(0, 5) };
  return { ok: false };
}

/** 参考金額（円）。0〜99,999,999 の整数のみ。null = クリア、undefined = 指定なし。 */
export function normalizeAmount(v: unknown): { ok: true; value: number | null | undefined } | { ok: false } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null || v === "") return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999) return { ok: false };
  return { ok: true, value: Math.round(n) };
}

export type MemberInput = {
  driver_id: string | null;
  display_name: string | null;
  pay_amount: number | null;
};

/**
 * 参加者配列の正規化。driverId も displayName も無い行は捨てる。
 * driverId の重複は unique index 違反になる前に 400 で返す。
 */
export function parseMembers(raw: unknown): { ok: true; members: MemberInput[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, members: [] };
  if (!Array.isArray(raw) || raw.length > 50) {
    return { ok: false, error: "参加者の指定が不正です" };
  }
  const members: MemberInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return { ok: false, error: "参加者の指定が不正です" };
    const rec = item as Record<string, unknown>;
    const driverId = typeof rec.driverId === "string" && rec.driverId ? rec.driverId : null;
    const displayName = typeof rec.displayName === "string" ? rec.displayName.trim().slice(0, 50) : "";
    const amount = normalizeAmount(rec.payAmount);
    if (!amount.ok) return { ok: false, error: "日当の金額が不正です" };
    if (!driverId && !displayName) continue; // 空行は無視
    if (driverId) {
      if (seen.has(driverId)) return { ok: false, error: "同じメンバーが重複しています" };
      seen.add(driverId);
    }
    members.push({
      driver_id: driverId,
      display_name: driverId ? null : displayName,
      pay_amount: amount.value ?? null,
    });
  }
  return { ok: true, members };
}

/** 指定 driver_id が全て自 org の membership か（他社の人を混ぜられないように）。 */
export async function verifyDriversInOrg(orgId: string, members: MemberInput[]): Promise<boolean> {
  const ids = members.map((m) => m.driver_id).filter((v): v is string => !!v);
  if (ids.length === 0) return true;
  const { data, error } = await supabase.from("drivers").select("id").eq("org_id", orgId).in("id", ids);
  if (error) {
    console.error("[spot-jobs] verify drivers error", error);
    return false;
  }
  return (data ?? []).length === ids.length;
}

export async function loadMembers(jobIds: string[]): Promise<Map<string, MemberRow[]>> {
  const map = new Map<string, MemberRow[]>();
  if (jobIds.length === 0) return map;
  const { data, error } = await supabase
    .from("spot_job_members")
    .select("id, job_id, driver_id, display_name, pay_amount")
    .in("job_id", jobIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  for (const row of data ?? []) {
    const list = map.get(row.job_id) ?? [];
    list.push(row);
    map.set(row.job_id, list);
  }
  return map;
}

/** org 内の1件を members 込みで取得（無ければ null）。 */
export async function fetchSpotJob(orgId: string, jobId: string): Promise<SerializedSpotJob | null> {
  const { data, error } = await supabase
    .from("spot_jobs")
    .select(SPOT_JOB_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const members = await loadMembers([data.id]);
  return serializeSpotJob(data, members.get(data.id) ?? []);
}
