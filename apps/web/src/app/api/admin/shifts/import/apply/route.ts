import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { isMissingOrgColumn } from "@/server/db/orgColumn";
import { supabase } from "@/server/db/client";
import { normalizeJa } from "@/server/ai/shiftImport";

export const dynamic = "force-dynamic";

type Assignment = { date: string; courseId: string; cycleNo?: number; driverId: string };
type Skipped = Assignment & { reason: "already_assigned" | "duplicate" | "invalid" };

const MAX_ASSIGNMENTS = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST: AI 取り込みで確定した割当を shifts に一括登録する。
// - 既存モデルに合わせ「休み」は行を作らない（割当のみ登録）
// - slot は (日付×コース) 内の空き番号を自動採番。既存行は上書きしない（安全側）
// - 1回の取り込みを shift_import_batches に記録し、後からまとめて取り消せるようにする
// - 管理者が確定した 名前→ドライバー / ラベル→コース の対応は辞書に保存し、次回の初期値に使う
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;

  try {
    const body = await req.json();
    const assignments = (body?.assignments ?? []) as Assignment[];
    const nameMappings = (body?.nameMappings ?? []) as { rawName: string; driverId: string }[];
    const labelMappings = (body?.labelMappings ?? []) as {
      rawLabel: string;
      courseId: string;
      cycleNo?: number;
    }[];
    const formatProfiles = (body?.formatProfiles ?? []) as {
      formatKey: string;
      mime: string;
      formatProfile: string;
    }[];
    const sources = ((body?.sources ?? []) as unknown[]).filter((s): s is string => typeof s === "string");
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return NextResponse.json({ error: "assignments are required" }, { status: 400 });
    }
    if (assignments.length > MAX_ASSIGNMENTS) {
      return NextResponse.json({ error: `一度に登録できるのは${MAX_ASSIGNMENTS}件までです` }, { status: 400 });
    }

    const orgId = await resolveOrgId(user.driverId);
    const { data: orgCourses } = await supabase
      .from("courses")
      .select("id, uses_cycles, course_cycles(cycle_no, active)")
      .eq("org_id", orgId);
    const { data: orgDrivers } = await supabase.from("drivers").select("id").eq("org_id", orgId);
    const courseIds = new Set((orgCourses ?? []).map((c) => c.id));
    const courseCycleNos = new Map<string, Set<number>>(
      (orgCourses ?? []).map((course) => [
        course.id,
        new Set(
          course.uses_cycles
            ? (course.course_cycles ?? [])
                .filter((cycle) => cycle.active !== false)
                .map((cycle) => Number(cycle.cycle_no))
            : [0],
        ),
      ]),
    );
    const driverIds = new Set((orgDrivers ?? []).map((d) => d.id));

    const skipped: Skipped[] = [];
    const valid: Assignment[] = [];
    const seen = new Set<string>();
    for (const a of assignments) {
      const ok =
        typeof a?.date === "string" &&
        DATE_RE.test(a.date) &&
        courseIds.has(a?.courseId) &&
        courseCycleNos.get(a?.courseId)?.has(Number(a?.cycleNo) || 0) &&
        driverIds.has(a?.driverId);
      if (!ok) {
        skipped.push({ ...a, reason: "invalid" });
        continue;
      }
      const key = `${a.date}|${a.driverId}|${a.courseId}|${Number(a.cycleNo) || 0}`;
      if (seen.has(key)) {
        // 同一リクエスト内で同じ日×同じ人が複数回出た場合は先勝ち
        skipped.push({ ...a, reason: "duplicate" });
        continue;
      }
      seen.add(key);
      valid.push({ ...a, cycleNo: Number(a.cycleNo) || 0 });
    }

    if (valid.length === 0) {
      return NextResponse.json({ registered: 0, skipped, batchId: null });
    }

    const dates = valid.map((a) => a.date).sort();
    // 自社のコース集合で絞る。絞らないと他社のシフトまで読み、1000行の上限で黙って
    // 切られたときに自社の既存割当を見落として二重割当になる。
    const { data: existing } = await supabase
      // tenant-scope-ok: courseIds は自社の courses（.eq("org_id", orgId)）から作った集合
      .from("shifts")
      .select("shift_date, course_id, cycle_no, slot, driver_id")
      .in("course_id", [...courseIds])
      .gte("shift_date", dates[0])
      .lte("shift_date", dates[dates.length - 1]);

    // その日に既に割当があるドライバー（上書きせずスキップして手動確認に委ねる）
    const existingByDriverDay = new Map<string, { courseId: string; cycleNo: number }[]>();
    for (const shift of existing ?? []) {
      if (!shift.driver_id) continue;
      const key = `${shift.shift_date}|${shift.driver_id}`;
      const values = existingByDriverDay.get(key) ?? [];
      values.push({ courseId: shift.course_id, cycleNo: Number(shift.cycle_no) || 0 });
      existingByDriverDay.set(key, values);
    }
    // (日付×コース) ごとの使用済み slot
    const usedSlots = new Map<string, Set<number>>();
    for (const s of existing ?? []) {
      const key = `${s.shift_date}|${s.course_id}|${Number(s.cycle_no) || 0}`;
      if (!usedSlots.has(key)) usedSlots.set(key, new Set());
      usedSlots.get(key)!.add(s.slot);
    }

    // 取り込みバッチ（migration 119 未適用でも本体は動くよう、失敗時は null で続行）
    //
    // 読み取った内容そのものを `extracted` に残す。後から「原本のとおりに入っているか」を
    // 照合する材料にする（docs/design/operational-risk-detection-2026-09.md O-1）。
    // 同じ誤読は同じまま通るので、原本との独立した確認の代わりにはならない。
    // ここに残すのは **AIが読み取った全件**で、既存割当でスキップした行も含める
    // （スキップした行が抜けていると「原本にあって未配置」を見つけられない）。
    const extractedRows = valid.map((a) => ({ date: a.date, courseId: a.courseId, cycleNo: a.cycleNo ?? 0, driverId: a.driverId }));
    const extracted = {
      version: 1,
      readAt: new Date().toISOString(),
      sources,
      // 日×コース×便ごとに、原本が示すドライバーの集合へまとめる
      rows: Object.values(
        extractedRows.reduce<Record<string, { date: string; courseId: string; cycleNo: number; driverIds: string[] }>>((acc, row) => {
          const key = `${row.date}|${row.courseId}|${row.cycleNo}`;
          acc[key] ??= { date: row.date, courseId: row.courseId, cycleNo: row.cycleNo, driverIds: [] };
          acc[key].driverIds.push(row.driverId);
          return acc;
        }, {}),
      ),
    };
    let batchId: string | null = null;
    {
      const base = { org_id: orgId, created_by: user.driverId, sources };
      const { data: batch, error } = await supabase
        // tenant-scope-ok: base.org_id は認証済みの orgId
        .from("shift_import_batches")
        .insert({ ...base, extracted, covers_start: dates[0], covers_end: dates[dates.length - 1] })
        .select("id")
        .single();
      if (error) {
        // migration 168 未適用の環境では新しい列が無い。取り込み自体は止めない
        // tenant-scope-ok: base.org_id は認証済みの orgId
        const { data: fallback } = await supabase.from("shift_import_batches").insert(base).select("id").single();
        batchId = fallback?.id ?? null;
      } else {
        batchId = batch?.id ?? null;
      }
    }

    const rows: Record<string, unknown>[] = [];
    for (const a of valid) {
      const driverDayKey = `${a.date}|${a.driverId}`;
      const existingForDriver = existingByDriverDay.get(driverDayKey) ?? [];
      const exactExists = existingForDriver.some(
        (item) => item.courseId === a.courseId && item.cycleNo === (a.cycleNo ?? 0),
      );
      const otherCourseExists = existingForDriver.some((item) => item.courseId !== a.courseId);
      if (exactExists || otherCourseExists) {
        skipped.push({ ...a, reason: "already_assigned" });
        continue;
      }
      const slotKey = `${a.date}|${a.courseId}|${a.cycleNo ?? 0}`;
      if (!usedSlots.has(slotKey)) usedSlots.set(slotKey, new Set());
      const used = usedSlots.get(slotKey)!;
      let slot = 1;
      while (used.has(slot)) slot++;
      used.add(slot);
      existingByDriverDay.set(driverDayKey, [
        ...existingForDriver,
        { courseId: a.courseId, cycleNo: a.cycleNo ?? 0 },
      ]);
      const row: Record<string, unknown> = {
        org_id: orgId,
        shift_date: a.date,
        course_id: a.courseId,
        cycle_no: a.cycleNo ?? 0,
        slot,
        driver_id: a.driverId,
        updated_at: new Date().toISOString(),
      };
      if (batchId) row.import_batch_id = batchId;
      rows.push(row);
    }

    if (rows.length > 0) {
      // 既存行の上書きを避けるため upsert ではなく insert（衝突時はエラーで全体を守る）
      // tenant-scope-ok: rows の各行に org_id: orgId（認証済み）を入れている
      let { error } = await supabase.from("shifts").insert(rows);
      if (isMissingOrgColumn(error)) {
        // migration 175 未適用の環境向けフォールバック（org_id 列がまだ無い）
        for (const r of rows) delete r.org_id;
        // tenant-scope-ok: 同じ行の退避。migration 175 未適用（org_id 列が無い）環境でのみ通る
        ({ error } = await supabase.from("shifts").insert(rows));
      }
      if (error && batchId) {
        // import_batch_id 列が未適用の環境向けフォールバック
        await supabase.from("shift_import_batches").delete().eq("org_id", orgId).eq("id", batchId);
        batchId = null;
        for (const r of rows) delete r.import_batch_id;
        // tenant-scope-ok: 同じ rows の再送。org_id は上で入れている（175 未適用時のみ落ちている）
        ({ error } = await supabase.from("shifts").insert(rows));
      }
      if (error) throw error;
    }

    if (batchId) {
      await supabase.from("shift_import_batches").update({ registered: rows.length }).eq("org_id", orgId).eq("id", batchId);
    }

    // 確定済み対応を辞書へ保存（次回の取り込みで初期値に使う）。失敗しても本体は成功扱い。
    const nameRows = nameMappings
      .filter((m) => typeof m?.rawName === "string" && driverIds.has(m?.driverId))
      .map((m) => ({
        org_id: orgId,
        raw_name: normalizeJa(m.rawName),
        driver_id: m.driverId,
        updated_at: new Date().toISOString(),
      }))
      .filter((m) => m.raw_name !== "");
    if (nameRows.length > 0) {
      // tenant-scope-ok: nameRows の全行に認証済み orgId を設定し、driverIds も自社で絞る
      await supabase.from("shift_import_name_maps").upsert(nameRows, { onConflict: "org_id,raw_name" });
    }
    const labelRows = labelMappings
      .filter(
        (m) => {
          const cycleNo = Number(m?.cycleNo) || 0;
          return (
            typeof m?.rawLabel === "string" &&
            courseIds.has(m?.courseId) &&
            // 辞書では 0 を「全サイクル」として保持する。実際の shifts 行は上の検証で
            // 必ず有効な C1/C2... へ展開済みなので、cycle_no=0 の行は作られない。
            (cycleNo === 0 || courseCycleNos.get(m.courseId)?.has(cycleNo))
          );
        },
      )
      .map((m) => ({
        org_id: orgId,
        raw_label: normalizeJa(m.rawLabel),
        course_id: m.courseId,
        cycle_no: Number(m.cycleNo) || 0,
        updated_at: new Date().toISOString(),
      }))
      .filter((m) => m.raw_label !== "");
    if (labelRows.length > 0) {
      // tenant-scope-ok: labelRows の全行に認証済み orgId を設定し、courseIds も自社で絞る
      await supabase.from("shift_import_label_maps").upsert(labelRows, { onConflict: "org_id,raw_label" });
    }

    // 確定した帳票の構造だけを保存する。元ファイル・氏名・日別割当は保持しない。
    for (const profile of formatProfiles.slice(0, 10)) {
      const formatKey = typeof profile?.formatKey === "string" ? profile.formatKey.trim().slice(0, 500) : "";
      const layoutProfile =
        typeof profile?.formatProfile === "string" ? profile.formatProfile.trim().slice(0, 2000) : "";
      const mime = typeof profile?.mime === "string" ? profile.mime.trim().slice(0, 100) : "";
      if (!formatKey || !layoutProfile || !mime) continue;
      const { data: existingProfile } = await supabase
        .from("shift_import_format_profiles")
        .select("id, use_count")
        .eq("org_id", orgId)
        .eq("format_key", formatKey)
        .maybeSingle();
      if (existingProfile) {
        await supabase
          .from("shift_import_format_profiles")
          .update({
            mime_type: mime,
            layout_profile: layoutProfile,
            use_count: Math.max(1, Number(existingProfile.use_count) || 1) + 1,
            last_used_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("org_id", orgId)
          .eq("id", existingProfile.id);
      } else {
        await supabase.from("shift_import_format_profiles").insert({
          org_id: orgId,
          format_key: formatKey,
          mime_type: mime,
          layout_profile: layoutProfile,
        });
      }
    }

    return NextResponse.json({ registered: rows.length, skipped, batchId });
  } catch (err) {
    console.error("[admin/shifts/import/apply] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
