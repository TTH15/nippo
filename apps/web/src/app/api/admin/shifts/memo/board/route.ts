import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requirePermission } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { BOARD_MAP_FIELDS, BOARD_VALUE_FIELDS, type BoardChange } from "@/lib/shiftMemo/sharedBoardSync";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, "can_view_shifts");
  if (isAuthError(user)) return user;
  const orgId = user.orgId ?? await resolveOrgId(user.driverId);
  const { data, error } = await supabase.from("shared_shift_memo_boards")
    .select("board, revision, updated_at").eq("org_id", orgId).maybeSingle();
  if (error) {
    console.error("[shared shift memo] load error", error);
    return NextResponse.json({ error: "共有メモを読み込めませんでした" }, { status: 503 });
  }
  return NextResponse.json({ board: data?.board ?? null, revision: data?.revision ?? 0, updatedAt: data?.updated_at ?? null });
}

export async function PATCH(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;
  const body = await req.json().catch(() => null);
  const initialBoard = body?.initialBoard;
  const changes = body?.changes as BoardChange[] | undefined;
  const mapFields = new Set<string>(BOARD_MAP_FIELDS);
  const valueFields = new Set<string>(BOARD_VALUE_FIELDS);
  const validValue = (change: BoardChange) => {
    if (change.value === null) return mapFields.has(change.field);
    if (change.field === "notes") return typeof change.value === "string" && change.value.length <= 2000;
    if (change.field === "dayOverrides") return change.value === "on" || change.value === "off";
    if (change.field === "requiredCountOverrides") return Number.isInteger(change.value) && Number(change.value) >= 0 && Number(change.value) <= 10;
    if (change.field === "widths") return typeof change.value === "object" && !Array.isArray(change.value);
    return Array.isArray(change.value);
  };
  if (initialBoard !== null && (typeof initialBoard !== "object" || Array.isArray(initialBoard) || initialBoard.version !== 1
    || !Array.isArray(initialBoard.lanes) || !Array.isArray(initialBoard.laneOrder)
    || !initialBoard.assignments || typeof initialBoard.assignments !== "object" || Array.isArray(initialBoard.assignments)
    || JSON.stringify(initialBoard).length > 1048576)
    || !Array.isArray(changes) || changes.length < 1 || changes.length > 1000 || JSON.stringify(changes).length > 1048576
    || changes.some((change) => !change || typeof change !== "object" || !Object.hasOwn(change, "expected") || !Object.hasOwn(change, "value")
      || !(mapFields.has(change.field) && typeof change.key === "string" && change.key.length > 0 && change.key.length <= 200
        || valueFields.has(change.field) && change.key === undefined) || !validValue(change))) {
    return NextResponse.json({ error: "共有メモの内容を確認してください" }, { status: 400 });
  }
  const orgId = user.orgId ?? await resolveOrgId(user.driverId);
  const { data, error } = await supabase.rpc("save_shared_shift_memo_board", {
    p_org_id: orgId, p_actor_id: user.driverId, p_initial_board: initialBoard, p_changes: changes,
  });
  if (error) {
    console.error("[shared shift memo] save error", error);
    return NextResponse.json({ error: "共有メモを保存できませんでした" }, { status: 503 });
  }
  if (!data?.saved) return NextResponse.json({ error: "同じ箇所を他の人が更新しました。最新の内容を確認してください", revision: data?.revision }, { status: 409 });
  return NextResponse.json({ revision: data.revision, board: data.board });
}
