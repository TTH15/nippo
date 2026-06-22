import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// GET: 全コース一覧
export async function GET(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN_OR_VIEWER");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  const { data: courses, error } = await supabase
    .from("courses")
    .select("*")
    .eq("org_id", orgId)
    .order("sort_order");

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ courses });
}

// POST: コース追加
export async function POST(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);

  try {
    const body = await req.json();
    const {
      name,
      color = "#3b82f6",
      max_drivers,
      carrier: carrierRaw,
      carrier_id: carrierIdRaw,
      summary_title: summaryTitle,
      daily_lease: dailyLeaseRaw,
      principal_invoice_address_id: principalInvoiceAddressIdRaw,
      counterparty_invoice_address_id: counterpartyInvoiceAddressIdRaw,
      slot_id: slotIdRaw,
    } = body as {
      name?: string;
      color?: string;
      max_drivers?: number;
      carrier?: string;
      carrier_id?: string | null;
      summary_title?: string | null;
      daily_lease?: number | null;
      principal_invoice_address_id?: string | null;
      counterparty_invoice_address_id?: string | null;
      slot_id?: string | null;
    };

    if (!name || typeof name !== "string") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const capacity =
      typeof max_drivers === "number" && Number.isFinite(max_drivers) && max_drivers >= 1
        ? Math.floor(max_drivers)
        : 1;

    const carrier =
      carrierRaw === "YAMATO" || carrierRaw === "AMAZON" ? carrierRaw : "OTHER";

    const principalInvoiceAddressId =
      typeof principalInvoiceAddressIdRaw === "string"
        ? principalInvoiceAddressIdRaw.trim() || null
        : principalInvoiceAddressIdRaw === null
          ? null
          : null;
    const counterpartyInvoiceAddressId =
      typeof counterpartyInvoiceAddressIdRaw === "string"
        ? counterpartyInvoiceAddressIdRaw.trim() || null
        : counterpartyInvoiceAddressIdRaw === null
          ? null
          : null;

    if (principalInvoiceAddressId) {
      const { data: addr, error: addrErr } = await supabase
        .from("invoice_addresses")
        .select("id")
        .eq("id", principalInvoiceAddressId)
        .eq("org_id", orgId)
        .maybeSingle();

      if (addrErr || !addr) {
        return NextResponse.json({ error: "指定された元請け（請求元）が存在しません" }, { status: 400 });
      }
    }
    if (counterpartyInvoiceAddressId) {
      const { data: addr, error: addrErr } = await supabase
        .from("invoice_addresses")
        .select("id")
        .eq("id", counterpartyInvoiceAddressId)
        .eq("org_id", orgId)
        .maybeSingle();

      if (addrErr || !addr) {
        return NextResponse.json({ error: "指定された取引先（請求先）が存在しません" }, { status: 400 });
      }
    }

    // Get max sort order
    const { data: maxData } = await supabase
      .from("courses")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();

    const sortOrder = (maxData?.sort_order ?? 0) + 1;

    const insertRow: Record<string, unknown> = {
      org_id: orgId,
      name: name.trim(),
      color,
      sort_order: sortOrder,
      max_drivers: capacity,
      carrier,
      carrier_id: typeof carrierIdRaw === "string" && carrierIdRaw ? carrierIdRaw : null,
      principal_invoice_address_id: principalInvoiceAddressId,
      counterparty_invoice_address_id: counterpartyInvoiceAddressId,
      slot_id: typeof slotIdRaw === "string" && slotIdRaw ? slotIdRaw : null,
    };
    if (summaryTitle !== undefined) {
      insertRow.summary_title = typeof summaryTitle === "string" && summaryTitle.trim() !== "" ? summaryTitle.trim() : null;
    }
    if (dailyLeaseRaw !== undefined) {
      insertRow.daily_lease = Math.max(0, Math.trunc(Number(dailyLeaseRaw) || 0));
    }
    const { data: course, error } = await supabase
      .from("courses")
      .insert(insertRow)
      .select()
      .single();

    if (error) {
      console.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Phase9-C: 旧 course_rates へのデフォルト投入は廃止。
    // 単価は新モデル（course_unit_rates / course_fixed_rates）を CourseRateEditor で設定する。

    return NextResponse.json({ course });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH: コース並べ替え
export async function PATCH(req: NextRequest) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const { order: orderIds } = body as { order?: string[] };

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json({ error: "order array is required" }, { status: 400 });
    }

    for (let i = 0; i < orderIds.length; i++) {
      const id = orderIds[i];
      if (typeof id !== "string") continue;
      const { error } = await supabase
        .from("courses")
        .update({ sort_order: i })
        .eq("id", id);
      if (error) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
