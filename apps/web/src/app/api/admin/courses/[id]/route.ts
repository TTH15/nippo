import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/server/auth";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// PUT: コース名・色の更新
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Invalid course id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const {
      name,
      color,
      max_drivers,
      carrier: carrierRaw,
      summary_title: summaryTitle,
      daily_lease: dailyLeaseRaw,
      principal_invoice_address_id: principalInvoiceAddressIdRaw,
      counterparty_invoice_address_id: counterpartyInvoiceAddressIdRaw,
    } = body as {
      name?: string;
      color?: string;
      max_drivers?: number;
      carrier?: string;
      summary_title?: string | null;
      daily_lease?: number | null;
      principal_invoice_address_id?: string | null;
      counterparty_invoice_address_id?: string | null;
    };

    const updates: Record<string, unknown> = {};
    if (typeof name === "string") {
      const trimmed = name.trim();
      if (!trimmed) {
        return NextResponse.json({ error: "Name is required" }, { status: 400 });
      }
      updates.name = trimmed;
    }
    if (typeof color === "string") {
      updates.color = color;
    }
    if (carrierRaw === "YAMATO" || carrierRaw === "AMAZON" || carrierRaw === "OTHER") {
      updates.carrier = carrierRaw;
    }
    if ("carrier_id" in (body as Record<string, unknown>)) {
      const cid = (body as { carrier_id?: unknown }).carrier_id;
      updates.carrier_id = typeof cid === "string" && cid ? cid : null;
    }
    if ("slot_id" in (body as Record<string, unknown>)) {
      const sid = (body as { slot_id?: unknown }).slot_id;
      updates.slot_id = typeof sid === "string" && sid ? sid : null;
    }
    if (summaryTitle !== undefined) {
      updates.summary_title = typeof summaryTitle === "string" && summaryTitle.trim() !== "" ? summaryTitle.trim() : null;
    }
    if (dailyLeaseRaw !== undefined) {
      updates.daily_lease = Math.max(0, Math.trunc(Number(dailyLeaseRaw) || 0));
    }

    if (principalInvoiceAddressIdRaw !== undefined) {
      const principalInvoiceAddressId =
        typeof principalInvoiceAddressIdRaw === "string"
          ? principalInvoiceAddressIdRaw.trim() || null
          : principalInvoiceAddressIdRaw === null
            ? null
            : null;

      if (principalInvoiceAddressId) {
        const { data: addr, error: addrErr } = await supabase
          .from("invoice_addresses")
          .select("id")
          .eq("id", principalInvoiceAddressId)
          .eq("company_code", user.companyCode)
          .maybeSingle();

        if (addrErr || !addr) {
          return NextResponse.json({ error: "指定された元請け（請求元）が存在しません" }, { status: 400 });
        }
      }

      updates.principal_invoice_address_id = principalInvoiceAddressId;
    }
    if (counterpartyInvoiceAddressIdRaw !== undefined) {
      const counterpartyInvoiceAddressId =
        typeof counterpartyInvoiceAddressIdRaw === "string"
          ? counterpartyInvoiceAddressIdRaw.trim() || null
          : counterpartyInvoiceAddressIdRaw === null
            ? null
            : null;

      if (counterpartyInvoiceAddressId) {
        const { data: addr, error: addrErr } = await supabase
          .from("invoice_addresses")
          .select("id")
          .eq("id", counterpartyInvoiceAddressId)
          .eq("company_code", user.companyCode)
          .maybeSingle();

        if (addrErr || !addr) {
          return NextResponse.json({ error: "指定された取引先（請求先）が存在しません" }, { status: 400 });
        }
      }
      updates.counterparty_invoice_address_id = counterpartyInvoiceAddressId;
    }

    if (max_drivers !== undefined) {
      const capacity =
        typeof max_drivers === "number" && Number.isFinite(max_drivers) && max_drivers >= 1
          ? Math.floor(max_drivers)
          : 1;
      updates.max_drivers = capacity;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { error } = await supabase
      .from("courses")
      .update(updates)
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE: コース削除
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(req, "ADMIN");
  if (isAuthError(user)) return user;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Invalid course id" }, { status: 400 });
  }

  try {
    // 関連レコードを先に削除
    await supabase.from("driver_courses").delete().eq("course_id", id);
    await supabase.from("course_rates").delete().eq("course_id", id);
    await supabase.from("shifts").delete().eq("course_id", id);

    const { error } = await supabase.from("courses").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

