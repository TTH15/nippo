import { NextRequest, NextResponse } from "next/server";
import { requirePermission, isAuthError } from "@/server/auth";
import { resolveOrgId } from "@/server/db/tenant";
import { supabase } from "@/server/db/client";
import { isAnthropicConfigured } from "@/server/ai/client";
import {
  extractShiftFile,
  mergeExtractedFiles,
  computeChecks,
  normalizeJa,
  isOffLabel,
  suggestDriverId,
  suggestCourseId,
  suggestCycleNo,
  resolveCourseByName,
  shiftImportFormatKey,
  isReliableFastExtraction,
  type ImportFile,
} from "@/server/ai/shiftImport";

export const dynamic = "force-dynamic";
// AI 読み取りはファイル数×1〜数分かかり得るため関数の上限まで確保する。
export const maxDuration = 300;

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_FILES = 10;
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// POST: シフト表ファイル（PDF/画像）を AI で読み取り、
// 「人 × 日 × ラベル」＋ドライバー/コースの対応候補＋検算結果を返す（DB には書き込まない）。
// 対応候補は「確定済み辞書（過去に管理者が承認した対応）」を最優先し、無いものだけ推測する。
// multipart/form-data: files（複数可）, year, month
export async function POST(req: NextRequest) {
  const user = await requirePermission(req, "can_manage_shifts");
  if (isAuthError(user)) return user;

  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      { error: "AI 読み取りが未設定です（ANTHROPIC_API_KEY を設定してください）" },
      { status: 503 },
    );
  }

  try {
    const form = await req.formData();
    const year = Number(form.get("year"));
    const month = Number(form.get("month"));
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "year and month are required" }, { status: 400 });
    }

    const rawFiles = form.getAll("files").filter((f): f is File => f instanceof File);
    if (rawFiles.length === 0) {
      return NextResponse.json({ error: "files are required" }, { status: 400 });
    }
    if (rawFiles.length > MAX_FILES) {
      return NextResponse.json({ error: `ファイルは最大${MAX_FILES}件までです` }, { status: 400 });
    }

    const files: ImportFile[] = [];
    for (const f of rawFiles) {
      const mime = f.type || "application/octet-stream";
      if (!ALLOWED_MIMES.has(mime)) {
        return NextResponse.json(
          { error: `「${f.name}」は対応していない形式です（PDF / JPEG / PNG / WebP）` },
          { status: 400 },
        );
      }
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `「${f.name}」が大きすぎます（8MBまで）` }, { status: 400 });
      }
      files.push({ name: f.name, mime, bytes: new Uint8Array(await f.arrayBuffer()) });
    }

    // AI へ「登録済みコース一覧」を渡すため、抽出の前に org データを取得する
    const orgId = await resolveOrgId(user.driverId);
    const { data: drivers } = await supabase
      .from("drivers")
      .select("id, name, display_name")
      .eq("org_id", orgId)
      .eq("works_as_driver", true)
      .eq("status", "active");
    const { data: courses } = await supabase
      .from("courses")
      .select("id, name, summary_title, uses_cycles, course_cycles(cycle_no, label, active)")
      .eq("org_id", orgId);

    // 確定済みの同形式プロファイルを先に引く。migration 148 未適用時は空扱いで通常解析を続ける。
    const formatKeys = files
      .map((file) => shiftImportFormatKey(file.name, file.mime))
      .filter((key): key is string => !!key);
    const profileByKey = new Map<string, { layout_profile: string }>();
    if (formatKeys.length > 0) {
      const { data: profiles } = await supabase
        .from("shift_import_format_profiles")
        .select("format_key, layout_profile")
        .eq("org_id", orgId)
        .in("format_key", [...new Set(formatKeys)]);
      for (const profile of profiles ?? []) profileByKey.set(profile.format_key, profile);
    }

    // ファイルごとに並列で読み取り。確定済み形式は高速モデルを先に使い、
    // 最低限の検算に落ちた場合だけ通常モデルへ自動フォールバックする。
    const settled = await Promise.allSettled(
      files.map(async (file) => {
        const formatKey = shiftImportFormatKey(file.name, file.mime);
        const savedProfile = formatKey ? profileByKey.get(formatKey)?.layout_profile ?? null : null;
        if (savedProfile) {
          try {
            const fast = await extractShiftFile(file, { year, month }, courses ?? [], {
              knownFormatProfile: savedProfile,
              fast: true,
            });
            if (isReliableFastExtraction(fast)) {
              return { result: fast, formatKey, mime: file.mime, analysisMode: "fast" as const };
            }
          } catch (error) {
            console.warn(`[shift-import] fast extraction fallback: ${file.name}`, error);
          }
        }
        const standard = await extractShiftFile(file, { year, month }, courses ?? [], {
          knownFormatProfile: savedProfile,
        });
        return {
          result: standard,
          formatKey,
          mime: file.mime,
          analysisMode: savedProfile ? ("fallback" as const) : ("standard" as const),
        };
      }),
    );
    const results = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    const failures = settled.flatMap((s, i) =>
      s.status === "rejected"
        ? [`${files[i].name}: ${s.reason instanceof Error ? s.reason.message : "読み取りに失敗しました"}`]
        : [],
    );
    if (results.length === 0) {
      return NextResponse.json(
        { error: `読み取りに失敗しました: ${failures.join(" / ")}` },
        { status: 502 },
      );
    }

    const merged = mergeExtractedFiles(results.map((entry) => entry.result));
    // 資料内の集計（出勤日数・◯◯人数）と抽出結果の検算
    const checks = computeChecks(merged.people, merged.dayTotals);
    const driverIds = (drivers ?? []).map((d) => d.id);

    // 確定済み辞書（migration 119 未適用でも動くよう、失敗時は空扱い）
    const nameDict = new Map<string, string>();
    const labelDict = new Map<string, { courseId: string; cycleNo: number }>();
    {
      const { data } = await supabase
        .from("shift_import_name_maps")
        .select("raw_name, driver_id")
        .eq("org_id", orgId);
      for (const m of data ?? []) nameDict.set(m.raw_name, m.driver_id);
    }
    {
      const { data } = await supabase
        .from("shift_import_label_maps")
        .select("raw_label, course_id, cycle_no")
        .eq("org_id", orgId);
      for (const m of data ?? []) {
        labelDict.set(m.raw_label, { courseId: m.course_id, cycleNo: Number(m.cycle_no) || 0 });
      }
    }

    // 人違い検出・同日重複の解決に使う文脈:
    // 担当コース / 対象月の希望休（全休のみ）/ 過去約1ヶ月＋対象月の勤務実績
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    const historyStart = new Date(monthStart);
    historyStart.setDate(historyStart.getDate() - 35);

    const { data: driverCourses } = await supabase
      .from("driver_courses")
      .select("driver_id, course_id")
      .in("driver_id", driverIds);
    const { data: offRequests } = await supabase
      .from("shift_requests")
      .select("driver_id, request_date, slot_id")
      .in("driver_id", driverIds)
      .gte("request_date", ymd(monthStart))
      .lte("request_date", ymd(monthEnd));
    const { data: recentShifts } = await supabase
      .from("shifts")
      .select("driver_id, course_id")
      .not("driver_id", "is", null)
      .gte("shift_date", ymd(historyStart))
      .lte("shift_date", ymd(monthEnd));

    const driverContext: Record<
      string,
      { courseIds: string[]; offDates: string[]; recentCourseCounts: Record<string, number> }
    > = {};
    const ctx = (id: string) => {
      if (!driverContext[id]) driverContext[id] = { courseIds: [], offDates: [], recentCourseCounts: {} };
      return driverContext[id];
    };
    for (const dc of driverCourses ?? []) {
      const c = ctx(dc.driver_id);
      if (!c.courseIds.includes(dc.course_id)) c.courseIds.push(dc.course_id);
    }
    for (const r of offRequests ?? []) {
      // 全休（slot_id NULL）のみを「出勤と矛盾する希望休」として扱う
      if (r.slot_id === null) ctx(r.driver_id).offDates.push(r.request_date);
    }
    for (const s of recentShifts ?? []) {
      const c = ctx(s.driver_id as string);
      c.recentCourseCounts[s.course_id] = (c.recentCourseCounts[s.course_id] ?? 0) + 1;
    }

    const people = merged.people.map((p) => {
      const saved = nameDict.get(normalizeJa(p.name)) ?? null;
      const guessed = saved ? null : suggestDriverId(p.name, drivers ?? []);
      return {
        ...p,
        suggestedDriverId: saved ?? guessed,
        suggestionSource: saved ? ("saved" as const) : guessed ? ("guessed" as const) : null,
      };
    });
    // ラベル→コースの候補: 確定辞書 > 決定的な名称一致 > AI のファイル文脈推定（「〇」等はこれで決まる）
    const labels = merged.labels.map((label) => {
      const saved = labelDict.get(normalizeJa(label)) ?? null;
      const matched = saved ? null : suggestCourseId(label, courses ?? []);
      const guessName = merged.labelGuesses[normalizeJa(label)];
      const ai = saved || matched || !guessName ? null : resolveCourseByName(guessName, courses ?? []);
      const courseId = saved?.courseId ?? matched ?? ai;
      const course = (courses ?? []).find((item) => item.id === courseId);
      const guessedCycle = guessName
        ? results
            .flatMap((entry) => entry.result.labelGuesses ?? [])
            .find((guess) => normalizeJa(guess.label) === normalizeJa(label))?.cycleNo ?? null
        : null;
      const cycleNo = saved?.cycleNo ?? guessedCycle ?? suggestCycleNo(label, course);
      return {
        label,
        suggestedCourseId: courseId,
        suggestedCycleNo: courseId ? cycleNo : 0,
        suggestionSource: saved
          ? ("saved" as const)
          : matched || ai
            ? ("guessed" as const)
            : null,
        isOff: isOffLabel(label),
      };
    });

    return NextResponse.json({
      people,
      labels,
      checks,
      conflicts: merged.conflicts,
      driverContext,
      warnings: [...failures, ...merged.warnings],
      sources: results.map((entry) => {
        // AI が誤って氏名を構造説明に含めても保存しないよう、抽出済みの氏名を伏せる。
        let profile = entry.result.formatProfile?.trim() || "";
        for (const person of entry.result.people) {
          if (person.name.trim()) profile = profile.split(person.name.trim()).join("氏名");
        }
        return {
          name: entry.result.sourceName,
          title: entry.result.title,
          formatKey: entry.formatKey,
          mime: entry.mime,
          formatProfile: profile.slice(0, 2000),
          analysisMode: entry.analysisMode,
        };
      }),
    });
  } catch (err) {
    console.error("[admin/shifts/import] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
