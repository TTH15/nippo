import type { SupabaseClient } from "@supabase/supabase-js";

// 請求書番号の正規化と重複回避。invoice_no には unique 制約があるため、
// 作成時は必ず resolveUniqueInvoiceNo を通してから insert する。

export function normalizeInvoiceNo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** "{base}" / "{base}-R{NN}" を次のリビジョンへ進める。 */
export function bumpInvoiceNo(invoiceNo: string): string {
  const s = String(invoiceNo || "").trim();
  if (!s) return "INV-MANUAL-R01";
  const m = s.match(/^(.*)-R(\d{2})$/);
  if (!m) return `${s}-R01`;
  const next = Math.min((Number(m[2]) || 0) + 1, 99);
  return `${m[1]}-R${String(next).padStart(2, "0")}`;
}

export async function isDuplicateInvoiceNo(
  supabase: SupabaseClient,
  orgId: string,
  invoiceNo: string | null | undefined,
  excludeId?: string,
): Promise<boolean> {
  const normalized = String(invoiceNo ?? "").trim();
  if (!normalized) return false;
  let query = supabase
    .from("invoice_documents")
    .select("id")
    .eq("org_id", orgId)
    .eq("invoice_no", normalized);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** 空いている請求書番号を返す。埋まっていればリビジョンを進める（最大120回）。 */
export async function resolveUniqueInvoiceNo(
  supabase: SupabaseClient,
  orgId: string,
  invoiceNo: string | null,
  excludeId?: string,
): Promise<string | null> {
  let candidate = normalizeInvoiceNo(invoiceNo);
  if (!candidate) return null;
  for (let i = 0; i < 120; i++) {
    const duplicated = await isDuplicateInvoiceNo(supabase, orgId, candidate, excludeId);
    if (!duplicated) return candidate;
    candidate = bumpInvoiceNo(candidate);
  }
  return `${candidate}-${Date.now().toString().slice(-4)}`;
}
