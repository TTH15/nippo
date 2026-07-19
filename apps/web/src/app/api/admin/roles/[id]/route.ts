import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { CAPABILITIES, type Capability } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// ============================================================
// ロールの更新・削除（§2-6）。can_manage_members でゲート。
// system ロール: label/capabilities/sort_order は編集可、key 変更と削除は不可。
// custom ロール: 全て編集可。削除はそのロールを使う membership が無いときのみ。
// ============================================================

const VALID = new Set<string>(CAPABILITIES);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_members");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  // org ガード（他社ロールは触れない）
  const { data: role } = await supabase
    .from("roles")
    .select("id, key, is_system")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!role) return NextResponse.json({ error: "ロールが見つかりません" }, { status: 404 });

  // ガバナンス保護: 管理者(ADMIN)はトップ権力者として全権限固定・弱体化不可。
  // これにより「自分で can_manage_members を外して誰も権限管理できなくなる」自己ロックアウトを防ぐ。
  const isAdminRole = role.is_system && role.key === "ADMIN";

  try {
    const body = await req.json();
    const update: Record<string, unknown> = {};
    if (typeof body.label === "string") {
      const label = body.label.trim();
      if (!label) return NextResponse.json({ error: "ロール名を入力してください" }, { status: 400 });
      update.label = label;
    }
    if (typeof body.sortOrder === "number") update.sort_order = body.sortOrder;
    // 「ドライバーとして扱う」フラグ。system の DRIVER ロールは常に ON（外すと
    // 全ドライバーがシフト・名簿から消えるため固定）。
    if (typeof body.worksAsDriver === "boolean") {
      if (role.is_system && role.key === "DRIVER" && !body.worksAsDriver) {
        return NextResponse.json(
          { error: "ドライバーロールは常にドライバーとして扱われます" },
          { status: 400 },
        );
      }
      update.works_as_driver = body.worksAsDriver;
    }
    if (Object.keys(update).length) {
      const { error } = await supabase.from("roles").update(update).eq("id", id).eq("org_id", orgId);
      if (error) {
        console.error("[roles] update error", error);
        return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
      }
      // drivers.works_as_driver は抽出クエリ用の非正規化コピー。ロール設定の変更を
      // このロールが割り当てられた全メンバーへ同期する。
      if ("works_as_driver" in update) {
        const { error: syncErr } = await supabase
          .from("drivers")
          .update({ works_as_driver: update.works_as_driver })
          .eq("role_id", id);
        if (syncErr) {
          console.error("[roles] works_as_driver sync error", syncErr);
          return NextResponse.json({ error: "メンバーへの反映に失敗しました" }, { status: 500 });
        }
      }
    }

    // 管理者ロールの権限は固定（全権限）。capability 変更は受け付けない。
    if (isAdminRole && Array.isArray(body.capabilities)) {
      return NextResponse.json(
        { error: "管理者はトップ権限のため、権限の変更はできません" },
        { status: 400 },
      );
    }

    // capabilities を差し替え（指定があれば）。system ロールでも束は調整可（ADMIN を除く）。
    if (Array.isArray(body.capabilities)) {
      const caps: string[] = body.capabilities;
      const invalid = caps.filter((c) => !VALID.has(c));
      if (invalid.length) return NextResponse.json({ error: `未知の権限: ${invalid.join(", ")}` }, { status: 400 });
      await supabase.from("role_capabilities").delete().eq("role_id", id);
      const rows = (caps as Capability[]).map((c) => ({ role_id: id, capability: c }));
      if (rows.length) {
        const { error: capErr } = await supabase.from("role_capabilities").insert(rows);
        if (capErr) {
          console.error("[roles] capability replace error", capErr);
          return NextResponse.json({ error: "権限の保存に失敗しました" }, { status: 500 });
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[roles] PATCH", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(req, "can_manage_members");
  if (isAuthError(user)) return user;
  const orgId = await resolveOrgId(user.driverId);
  const { id } = await params;

  const { data: role } = await supabase
    .from("roles")
    .select("id, is_system")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!role) return NextResponse.json({ error: "ロールが見つかりません" }, { status: 404 });
  if (role.is_system) return NextResponse.json({ error: "システム既定ロールは削除できません" }, { status: 400 });

  // 使用中（このロールの membership が存在）なら削除不可
  const { count } = await supabase
    .from("drivers")
    .select("id", { count: "exact", head: true })
    .eq("role_id", id);
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: "このロールが割り当てられたメンバーがいるため削除できません" }, { status: 400 });
  }

  const { error } = await supabase.from("roles").delete().eq("id", id).eq("org_id", orgId);
  if (error) {
    console.error("[roles] delete error", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
