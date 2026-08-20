import type { SupabaseClient } from "@supabase/supabase-js";
import { computeCounterpartyMonthBillingDetail } from "./computeCounterpartyMonthRevenue";

export type SnapshotMainLine = {
  lineKey: string;
  rowType: "system" | "sales_log_revenue" | "merged" | "custom_main";
  refId: string | null;
  defaultLabel: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  priceBasis?: "exclusive" | "inclusive";
};

export type SnapshotDeductLine = {
  lineKey: string;
  rowType: "sales_log_loss" | "custom_deduction";
  refId: string | null;
  defaultLabel: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type CounterpartyBillingSnapshot = {
  month: string;
  mainLines: SnapshotMainLine[];
  deductLines: SnapshotDeductLine[];
  /** シフト・コース単価のみ（統合前・売上ログ除く） */
  shiftSystemTotal: number;
  mainSubtotal: number;
  deductSubtotal: number;
  grandTotal: number;
};

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function applyLabel(labelMap: Map<string, string>, lineKey: string, fallback: string) {
  const o = labelMap.get(lineKey);
  return o && o.trim() !== "" ? o.trim() : fallback;
}

/** 統合作成時: 同一単価判定に使う候補マップ */
export type MergeCandidate = {
  lineKey: string;
  quantity: number;
  unitPrice: number;
  defaultLabel: string;
};

export async function buildMergeCandidateMap(
  supabase: SupabaseClient,
  orgId: string,
  companyCode: string,
  invoiceAddressId: string,
  startDate: string,
  endDate: string,
  monthYm: string
): Promise<Map<string, MergeCandidate>> {
  const map = new Map<string, MergeCandidate>();
  const { systemLines } = await computeCounterpartyMonthBillingDetail(
    supabase,
    orgId,
    startDate,
    endDate,
    invoiceAddressId
  );
  for (const s of systemLines) {
    map.set(s.lineKey, {
      lineKey: s.lineKey,
      quantity: s.quantity,
      unitPrice: s.unitPrice,
      defaultLabel: s.label,
    });
  }

  const { data: sl } = await supabase
    .from("sales_log_entries")
    .select("id, content, revenue, profit, sales_log_types ( name )")
    .eq("org_id", orgId)
    .eq("counterparty_invoice_address_id", invoiceAddressId)
    .gte("log_date", startDate)
    .lte("log_date", endDate);

  for (const r of sl ?? []) {
    const row = r as Record<string, unknown>;
    const id = String(row.id ?? "");
    const revenue = Number(row.revenue) || 0;
    const type = row.sales_log_types as { name?: string } | null;
    const typeName = type?.name ?? "";
    const content = String(row.content ?? "");
    if (revenue > 0) {
      const key = `slr:${id}`;
      map.set(key, {
        lineKey: key,
        quantity: 1,
        unitPrice: revenue,
        defaultLabel: typeName ? `${typeName} ${content}`.trim() : content,
      });
    }
  }

  const { data: customs } = await supabase
    .from("counterparty_monthly_custom_lines")
    .select("id, description, quantity, unit_price")
    .eq("org_id", orgId)
    .eq("invoice_address_id", invoiceAddressId)
    .eq("month_yyyy_mm", monthYm)
    .eq("row_kind", "main");

  for (const row of customs ?? []) {
    const rec = row as Record<string, unknown>;
    const id = String(rec.id ?? "");
    const key = `cu:${id}`;
    map.set(key, {
      lineKey: key,
      quantity: Number(rec.quantity) || 0,
      unitPrice: Number(rec.unit_price) || 0,
      defaultLabel: String(rec.description ?? ""),
    });
  }

  return map;
}

export async function buildCounterpartyBillingSnapshot(
  supabase: SupabaseClient,
  orgId: string,
  companyCode: string,
  invoiceAddressId: string,
  startDate: string,
  endDate: string,
  monthYm: string
): Promise<CounterpartyBillingSnapshot> {
  // 相互に独立な取得は1波で並列に流す（旧: 直列6段で往復が積み上がっていた）
  const [
    { systemLines, systemTotal: shiftSystemTotal },
    { data: labelRows, error: labelErr },
    { data: mergedList, error: mErr },
    { data: slRows, error: slErr },
    { data: customRows, error: cErr },
  ] = await Promise.all([
    computeCounterpartyMonthBillingDetail(supabase, orgId, startDate, endDate, invoiceAddressId),
    supabase
      .from("counterparty_monthly_line_labels")
      .select("line_key, display_label")
      .eq("org_id", orgId)
      .eq("invoice_address_id", invoiceAddressId)
      .eq("month_yyyy_mm", monthYm),
    supabase
      .from("counterparty_monthly_merged_lines")
      .select("id, sort_order, description, quantity, unit_price")
      .eq("org_id", orgId)
      .eq("invoice_address_id", invoiceAddressId)
      .eq("month_yyyy_mm", monthYm)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("sales_log_entries")
      .select("id, log_date, content, revenue, profit, sales_log_types ( name )")
      .eq("org_id", orgId)
      .eq("counterparty_invoice_address_id", invoiceAddressId)
      .gte("log_date", startDate)
      .lte("log_date", endDate)
      .order("log_date", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("counterparty_monthly_custom_lines")
      .select("id, description, quantity, unit_price, sort_order, row_kind, created_at")
      .eq("org_id", orgId)
      .eq("invoice_address_id", invoiceAddressId)
      .eq("month_yyyy_mm", monthYm)
      .order("row_kind", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (labelErr) throw labelErr;
  const labelMap = new Map<string, string>();
  (labelRows ?? []).forEach((r: Record<string, unknown>) => {
    const k = String(r.line_key ?? "");
    const v = String(r.display_label ?? "").trim();
    if (k && v) labelMap.set(k, v);
  });

  if (mErr) throw mErr;

  const mergedIds = (mergedList ?? []).map((m: { id: string }) => m.id);
  const suppressed = new Set<string>();

  if (mergedIds.length > 0) {
    const { data: srcRows, error: sErr } = await supabase
      .from("counterparty_monthly_merged_line_sources")
      .select("merged_line_id, source_line_key")
      .in("merged_line_id", mergedIds);
    if (sErr) throw sErr;
    (srcRows ?? []).forEach((r: Record<string, unknown>) => {
      suppressed.add(String(r.source_line_key ?? ""));
    });
  }

  const mainLines: SnapshotMainLine[] = [];

  for (const s of systemLines) {
    if (suppressed.has(s.lineKey)) continue;
    mainLines.push({
      lineKey: s.lineKey,
      rowType: "system",
      refId: null,
      defaultLabel: s.label,
      label: applyLabel(labelMap, s.lineKey, s.label),
      quantity: s.quantity,
      unitPrice: s.unitPrice,
      amount: roundMoney(s.amount),
      priceBasis: s.priceBasis,
    });
  }

  for (const m of mergedList ?? []) {
    const rec = m as Record<string, unknown>;
    const id = String(rec.id ?? "");
    const mgKey = `mg:${id}`;
    const qty = Number(rec.quantity) || 0;
    const unit = Number(rec.unit_price) || 0;
    const desc = String(rec.description ?? "");
    mainLines.push({
      lineKey: mgKey,
      rowType: "merged",
      refId: id,
      defaultLabel: desc,
      label: applyLabel(labelMap, mgKey, desc),
      quantity: qty,
      unitPrice: unit,
      amount: roundMoney(qty * unit),
    });
  }

  if (slErr) throw slErr;

  for (const r of slRows ?? []) {
    const row = r as Record<string, unknown>;
    const id = String(row.id ?? "");
    const revenue = Number(row.revenue) || 0;
    const type = row.sales_log_types as { name?: string } | null;
    const typeName = type?.name ?? "";
    const content = String(row.content ?? "");
    const slrKey = `slr:${id}`;
    if (revenue > 0) {
      if (suppressed.has(slrKey)) continue;
      const defLab = typeName ? `${typeName} ${content}`.trim() : content || "売上ログ";
      mainLines.push({
        lineKey: slrKey,
        rowType: "sales_log_revenue",
        refId: id,
        defaultLabel: defLab,
        label: applyLabel(labelMap, slrKey, defLab),
        quantity: 1,
        unitPrice: revenue,
        amount: roundMoney(revenue),
      });
    }
  }

  if (cErr) throw cErr;

  const deductLines: SnapshotDeductLine[] = [];

  for (const row of customRows ?? []) {
    const rec = row as Record<string, unknown>;
    const id = String(rec.id ?? "");
    const rk = String(rec.row_kind ?? "main");
    const qty = Number(rec.quantity) || 0;
    const unit = Number(rec.unit_price) || 0;
    const desc = String(rec.description ?? "");
    const amt = roundMoney(qty * unit);

    if (rk === "deduction") {
      const cuKey = `cud:${id}`;
      deductLines.push({
        lineKey: cuKey,
        rowType: "custom_deduction",
        refId: id,
        defaultLabel: desc,
        label: applyLabel(labelMap, cuKey, desc),
        quantity: qty,
        unitPrice: unit,
        amount: amt,
      });
      continue;
    }

    const cuKey = `cu:${id}`;
    if (suppressed.has(cuKey)) continue;
    mainLines.push({
      lineKey: cuKey,
      rowType: "custom_main",
      refId: id,
      defaultLabel: desc,
      label: applyLabel(labelMap, cuKey, desc),
      quantity: qty,
      unitPrice: unit,
      amount: amt,
    });
  }

  for (const r of slRows ?? []) {
    const row = r as Record<string, unknown>;
    const id = String(row.id ?? "");
    const profit = Number(row.profit) || 0;
    const type = row.sales_log_types as { name?: string } | null;
    const typeName = type?.name ?? "";
    const content = String(row.content ?? "");
    if (profit < 0) {
      const loss = -profit;
      const sllKey = `sll:${id}`;
      const defLab =
        (typeName ? `${typeName} ` : "") + (content || "マイナス計上") + "（控除）";
      deductLines.push({
        lineKey: sllKey,
        rowType: "sales_log_loss",
        refId: id,
        defaultLabel: defLab.trim(),
        label: applyLabel(labelMap, sllKey, defLab.trim()),
        quantity: 1,
        unitPrice: loss,
        amount: roundMoney(loss),
      });
    }
  }

  const mainSubtotal = roundMoney(mainLines.reduce((s, l) => s + l.amount, 0));
  const deductSubtotal = roundMoney(deductLines.reduce((s, l) => s + l.amount, 0));
  const grandTotal = roundMoney(mainSubtotal - deductSubtotal);

  return {
    month: monthYm,
    mainLines,
    deductLines,
    shiftSystemTotal,
    mainSubtotal,
    deductSubtotal,
    grandTotal,
  };
}
