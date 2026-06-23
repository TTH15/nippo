import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// 公開・参加API（Phase 7a）。認証不要。
// join_code → org（active のみ）を逆引きし、identity（人）＋ membership（drivers）を
// status='pending' で作成する。driver_code/PIN は付けない＝運営が承認時に発行。
// トークンは発行しない（承認されるまでログイン不可）。
//   設計: docs/platform-design.md §2-2, §7 Phase 7
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const joinCode = typeof body.joinCode === "string" ? body.joinCode.trim().toUpperCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";

    if (!joinCode) {
      return NextResponse.json({ error: "参加コードを入力してください" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "氏名を入力してください" }, { status: 400 });
    }

    // join_code → org（active のみ受け付ける）
    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("id, name, status")
      .eq("join_code", joinCode)
      .maybeSingle();
    if (orgErr) {
      console.error("[Join] org lookup error:", orgErr);
      return NextResponse.json({ error: "サーバーエラー" }, { status: 500 });
    }
    if (!org || org.status !== "active") {
      return NextResponse.json({ error: "参加コードが無効です" }, { status: 400 });
    }

    // 多重申請の抑止: 同 org に同 phone の pending が既にあれば作らず ok を返す。
    if (phone) {
      const { data: dup } = await supabase
        .from("drivers")
        .select("id")
        .eq("org_id", org.id)
        .eq("status", "pending")
        .eq("phone", phone)
        .maybeSingle();
      if (dup) {
        return NextResponse.json({ ok: true, organizationName: org.name, alreadyApplied: true });
      }
    }

    // identity（人）を作成
    const { data: identity, error: identErr } = await supabase
      .from("identities")
      .insert({ name, phone: phone || null })
      .select("id")
      .single();
    if (identErr || !identity) {
      console.error("[Join] identity insert error:", identErr);
      return NextResponse.json({ error: "申請の作成に失敗しました" }, { status: 500 });
    }

    // membership（drivers）を pending で作成。driver_code/PIN は承認時に発行。
    const { error: dErr } = await supabase.from("drivers").insert({
      org_id: org.id,
      identity_id: identity.id,
      role: "DRIVER",
      status: "pending",
      name,
      phone: phone || null,
    });
    if (dErr) {
      console.error("[Join] membership insert error:", dErr);
      return NextResponse.json({ error: "申請の作成に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, organizationName: org.name });
  } catch (err) {
    console.error("[Join] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
