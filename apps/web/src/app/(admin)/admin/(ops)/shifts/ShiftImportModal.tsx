"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileImport,
  faSpinner,
  faTriangleExclamation,
  faCircleCheck,
  faRotateLeft,
  faUserTag,
} from "@fortawesome/free-solid-svg-icons";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { apiFetch, getToken } from "@/lib/api";
import { getDisplayName } from "@/lib/displayName";

// ============================================================
// シフト表の AI 取り込み。
//   1) PDF/画像を画面にドロップ（または選択）して読み取り（/api/admin/shifts/import）
//   2) 人 → ドライバー、ラベル（勤務地・便）→ コース の対応を確認
//      - 資料内の集計（出勤日数・◯◯人数）との検算結果を表示
//      - 担当外コース（=人違いの可能性）・希望休との矛盾・同日重複を検出
//      - 同日重複は過去実績から最尤のコースを自動選択し、確信が持てなければ警告
//      - 実際のシフト表と同じ「人×日」グリッドでプレビュー
//   3) 一括登録（/api/admin/shifts/import/apply）。バッチ単位でいつでも取り消せる
// ファイルの受け皿はページ全体のドラッグ&ドロップ（page.tsx 側）。
// 「休み」は既存モデルどおり行を作らない。既存の割当は上書きしない。
// ============================================================

/** 取り込み対象にできるファイルか（ドロップは type が空のことがあるため拡張子でも判定） */
export function isImportableShiftFile(f: File): boolean {
  if (["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(f.type)) return true;
  return /\.(pdf|jpe?g|png|webp)$/i.test(f.name);
}

/** ドロップ・選択で追加されたファイルを重複なく合流させる */
export function mergeImportFiles(prev: File[], added: File[]): File[] {
  const key = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
  const seen = new Set(prev.map(key));
  return [...prev, ...added.filter((f) => !seen.has(key(f)))];
}

type ExtractedPerson = {
  name: string;
  days: Record<number, string>;
  sources: string[];
  total: number | null;
  suggestedDriverId: string | null;
  suggestionSource: "saved" | "guessed" | null;
};
type ExtractedLabel = {
  label: string;
  suggestedCourseId: string | null;
  suggestionSource: "saved" | "guessed" | null;
  isOff: boolean;
};
type ImportChecks = {
  personTotals: { name: string; expected: number; actual: number; ok: boolean }[];
  dayTotals: { day: number; label: string; expected: number; actual: number; ok: boolean }[];
};
type DriverContext = Record<
  string,
  { courseIds: string[]; offDates: string[]; recentCourseCounts: Record<string, number> }
>;
/** 出勤ラベル同士が別ファイルで食い違ったケース（休 vs 出勤は競合にならない） */
type MergeConflict = { name: string; day: number; kept: string; dropped: string; source: string };
type ExtractResult = {
  people: ExtractedPerson[];
  labels: ExtractedLabel[];
  checks: ImportChecks;
  conflicts: MergeConflict[];
  driverContext: DriverContext;
  warnings: string[];
  sources: { name: string; title: string }[];
};
type ImportBatch = {
  id: string;
  sources: string[];
  registered: number;
  reverted_at: string | null;
  created_at: string;
};

interface Props {
  open: boolean;
  year: number;
  month: number;
  courses: { id: string; name: string; color: string; summary_title?: string | null }[];
  drivers: { id: string; name: string; display_name?: string | null }[];
  /** 取り込むファイル。ページ全体のドロップでも追加されるため親が保持する */
  files: File[];
  onFilesChange: (files: File[]) => void;
  onClose: () => void;
  /** 登録・取り消し後に呼ばれる（呼び出し側で再読込する） */
  onApplied: () => void;
}

const IGNORE = "__ignore";

function hexToRgba(hex: string, alpha: number): string {
  const raw = (hex || "").replace("#", "").trim();
  if (raw.length !== 6 || !/^[0-9a-fA-F]+$/.test(raw)) return `rgba(148, 163, 184, ${alpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function ShiftImportModal({
  open,
  year,
  month,
  courses,
  drivers,
  files,
  onFilesChange,
  onClose,
  onApplied,
}: Props) {
  const [extracting, setExtracting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  // 抽出された名前 → driverId（"" = 取り込まない）
  const [personMap, setPersonMap] = useState<Record<string, string>>({});
  // 抽出されたラベル → courseId or IGNORE
  const [labelMap, setLabelMap] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<{
    registered: number;
    skipped: { date: string; driverId: string; reason: string }[];
    batchId: string | null;
  } | null>(null);
  const [reverted, setReverted] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // 直近バッチ（取り消し用）。モーダルを開いた時に取得
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const json = (await apiFetch("/api/admin/shifts/import/batches")) as { batches: ImportBatch[] };
        setBatches(json.batches ?? []);
      } catch {
        setBatches([]);
      }
    })();
  }, [open, applied]);

  const driverOptions = useMemo(
    () => drivers.map((d) => ({ value: d.id, label: getDisplayName(d) })),
    [drivers],
  );
  const courseOptions = useMemo(
    () => [
      ...courses.map((c) => ({ value: c.id, label: c.summary_title?.trim() || c.name })),
      { value: IGNORE, label: "取り込まない" },
    ],
    [courses],
  );
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const courseLabel = (id: string) => {
    const c = courseById.get(id);
    return c ? c.summary_title?.trim() || c.name : id;
  };
  const driverName = (id: string) => {
    const d = drivers.find((x) => x.id === id);
    return d ? getDisplayName(d) : id;
  };

  const daysInMonth = new Date(year, month, 0).getDate();
  const dateOf = (day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // ---- マッピング結果の解決 ----
  // 同じ日に同じドライバーへ複数コースが載る場合（別ファイルの同姓など）は、
  // ①担当コース優先（担当外=人違いの可能性が高い） ②過去約1ヶ月の実績頻度 で最尤を採用。
  // 確信が持てない場合は警告として表示する。
  const plan = useMemo(() => {
    if (!result) return null;
    const workLabelSet = new Set(result.labels.map((l) => l.label));
    const days = [...new Set(result.people.flatMap((p) => Object.keys(p.days).map(Number)))]
      .filter((d) => d >= 1 && d <= daysInMonth)
      .sort((a, b) => a - b);

    type Cand = { personName: string; day: number; label: string; courseId: string };
    const byDriverDay = new Map<string, Cand[]>();
    for (const p of result.people) {
      const driverId = personMap[p.name];
      if (!driverId) continue;
      for (const [dayStr, rawLabel] of Object.entries(p.days)) {
        const day = Number(dayStr);
        if (day < 1 || day > daysInMonth) continue;
        const label = rawLabel.trim();
        const courseId = labelMap[label];
        if (!courseId || courseId === IGNORE) continue;
        const key = `${driverId}|${day}`;
        if (!byDriverDay.has(key)) byDriverDay.set(key, []);
        byDriverDay.get(key)!.push({ personName: p.name, day, label, courseId });
      }
    }

    const assignments: { date: string; courseId: string; driverId: string }[] = [];
    const droppedCells = new Set<string>(); // `${personName}|${day}`
    const conflictNotes: { text: string; confident: boolean }[] = [];

    for (const [key, cands] of byDriverDay) {
      const [driverId, dayStr] = key.split("|");
      const day = Number(dayStr);
      const distinct = [...new Map(cands.map((c) => [c.courseId, c])).values()];
      let kept = distinct[0];
      if (distinct.length > 1) {
        const ctx = result.driverContext[driverId];
        const inCharge = ctx ? distinct.filter((c) => ctx.courseIds.includes(c.courseId)) : [];
        const pool = inCharge.length > 0 ? inCharge : distinct;
        const countOf = (c: Cand) => ctx?.recentCourseCounts[c.courseId] ?? 0;
        kept = [...pool].sort((a, b) => countOf(b) - countOf(a))[0];
        const others = distinct.filter((c) => c.courseId !== kept.courseId);
        const confident =
          inCharge.length === 1 ||
          (countOf(kept) >= 2 && others.every((c) => (ctx?.recentCourseCounts[c.courseId] ?? 0) === 0));
        for (const o of others) {
          for (const c of cands.filter((x) => x.courseId === o.courseId)) {
            droppedCells.add(`${c.personName}|${c.day}`);
          }
        }
        conflictNotes.push({
          text: `${driverName(driverId)} ${month}/${day}: 「${others
            .map((o) => `${o.personName}→${courseLabel(o.courseId)}`)
            .join("」「")}」と重複。実績から「${courseLabel(kept.courseId)}」を採用（同姓の別人=人違いの可能性も確認してください）`,
          confident,
        });
      }
      assignments.push({ date: dateOf(day), courseId: kept.courseId, driverId });
    }

    // 担当外コース（人違いシグナル）: 担当コースは必ず登録されている運用のため、
    // 担当に無いコースへの割当は「別人に紐付けている」可能性が高い。
    const mismatchNotes: string[] = [];
    for (const p of result.people) {
      const driverId = personMap[p.name];
      if (!driverId) continue;
      const ctx = result.driverContext[driverId];
      if (!ctx || ctx.courseIds.length === 0) continue;
      const usedCourseIds = new Set(
        Object.values(p.days)
          .map((v) => labelMap[v.trim()])
          .filter((v): v is string => Boolean(v) && v !== IGNORE),
      );
      const outside = [...usedCourseIds].filter((cid) => !ctx.courseIds.includes(cid));
      if (outside.length > 0) {
        mismatchNotes.push(
          `「${p.name}」→ ${driverName(driverId)}: ${outside
            .map(courseLabel)
            .join("・")} はこのドライバーの担当コースではありません（人違いの可能性）`,
        );
      }
    }

    // 希望休（全休）との矛盾
    const offConflictNotes: string[] = [];
    for (const a of assignments) {
      const ctx = result.driverContext[a.driverId];
      if (ctx?.offDates.includes(a.date)) {
        offConflictNotes.push(
          `${driverName(a.driverId)} ${a.date}: 希望休（全休）が提出されています（出勤と矛盾）`,
        );
      }
    }

    return {
      days,
      workLabelSet,
      assignments,
      droppedCells,
      conflictNotes,
      mismatchNotes,
      offConflictNotes,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, personMap, labelMap, year, month]);

  if (!open) return null;

  const reset = () => {
    onFilesChange([]);
    setResult(null);
    setError(null);
    setApplied(null);
    setReverted(false);
    setPersonMap({});
    setLabelMap({});
  };

  const handleClose = () => {
    if (extracting || applying) return;
    reset();
    onClose();
  };

  const handleExtract = async () => {
    if (files.length === 0) return;
    setExtracting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("year", String(year));
      fd.append("month", String(month));
      for (const f of files) fd.append("files", f);
      const token = getToken();
      const res = await fetch("/api/admin/shifts/import", {
        method: "POST",
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "読み取りに失敗しました");
      const data = json as ExtractResult;
      setResult(data);
      // 候補を初期値として反映（辞書=確定済みが最優先。未確定のものは空＝取り込まない/未選択）
      const pm: Record<string, string> = {};
      for (const p of data.people) pm[p.name] = p.suggestedDriverId ?? "";
      const lm: Record<string, string> = {};
      for (const l of data.labels) lm[l.label] = l.suggestedCourseId ?? "";
      setPersonMap(pm);
      setLabelMap(lm);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み取りに失敗しました");
    } finally {
      setExtracting(false);
    }
  };

  const handleApply = async () => {
    if (!result || !plan || plan.assignments.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const nameMappings = Object.entries(personMap)
        .filter(([, v]) => v)
        .map(([rawName, driverId]) => ({ rawName, driverId }));
      const labelMappings = Object.entries(labelMap)
        .filter(([, v]) => v && v !== IGNORE)
        .map(([rawLabel, courseId]) => ({ rawLabel, courseId }));
      const json = (await apiFetch("/api/admin/shifts/import/apply", {
        method: "POST",
        body: JSON.stringify({
          assignments: plan.assignments,
          nameMappings,
          labelMappings,
          sources: result.sources.map((s) => s.name),
        }),
      })) as {
        registered: number;
        skipped: { date: string; driverId: string; reason: string }[];
        batchId: string | null;
      };
      setApplied(json);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setApplying(false);
    }
  };

  const handleRevert = async (batchId: string, fromDoneView: boolean) => {
    setReverting(batchId);
    setError(null);
    try {
      await apiFetch(`/api/admin/shifts/import/batches/${batchId}/revert`, { method: "POST" });
      if (fromDoneView) setReverted(true);
      setBatches((bs) =>
        bs.map((b) => (b.id === batchId ? { ...b, reverted_at: new Date().toISOString() } : b)),
      );
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消しに失敗しました");
    } finally {
      setReverting(null);
    }
  };

  const unmappedLabels = result ? result.labels.filter((l) => !labelMap[l.label]) : [];
  const unmappedPeople = result ? result.people.filter((p) => !personMap[p.name]) : [];
  // 検算・競合は「ドライバーに紐付けた人」に絞って表示する（取り込まれない人のズレはノイズ）
  const mappedPersonTotals = result
    ? result.checks.personTotals.filter((c) => personMap[c.name])
    : [];
  const mappedConflicts = result ? result.conflicts.filter((c) => personMap[c.name]) : [];
  const checkFailures = result
    ? result.checks.dayTotals.filter((c) => !c.ok).length + mappedPersonTotals.filter((c) => !c.ok).length
    : 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div
        className="bg-white rounded-lg shadow-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">
            <FontAwesomeIcon icon={faFileImport} className="mr-2 text-slate-500" />
            シフト表の取り込み（AI 読み取り）
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            {year}年{month}月のシフト表を読み取り、検算・突き合わせで確認してから一括登録します。取り込みはいつでも取り消せます。
          </p>

          {/* 完了ビュー */}
          {applied ? (
            <div className="space-y-4">
              {reverted ? (
                <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  今回の取り込み（{applied.registered}件）を取り消しました。
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  {applied.registered}件のシフトを登録しました。
                </div>
              )}
              {!reverted && applied.skipped.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
                  <p className="font-medium">
                    {applied.skipped.length}件はスキップしました（既存の割当は上書きしません）:
                  </p>
                  <ul className="list-disc pl-4 max-h-40 overflow-y-auto">
                    {applied.skipped.map((s, i) => (
                      <li key={i}>
                        {s.date} {driverName(s.driverId)} —{" "}
                        {s.reason === "already_assigned"
                          ? "その日に既に割当あり"
                          : s.reason === "duplicate"
                            ? "重複"
                            : "無効なデータ"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex items-center justify-between">
                {applied.batchId && !reverted ? (
                  <button
                    type="button"
                    onClick={() => void handleRevert(applied.batchId!, true)}
                    disabled={reverting !== null}
                    className="px-3 py-2 text-xs font-medium rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    <FontAwesomeIcon icon={reverting ? faSpinner : faRotateLeft} spin={reverting !== null} />
                    今回の取り込みを取り消す
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-700"
                >
                  閉じる
                </button>
              </div>
            </div>
          ) : !result ? (
            /* ステップ1: ファイル選択 */
            <div className="space-y-4">
              <label className="block rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600 cursor-pointer hover:border-slate-400">
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={extracting}
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []).filter(isImportableShiftFile);
                    onFilesChange(mergeImportFiles(files, picked));
                    setError(null);
                    e.target.value = "";
                  }}
                />
                {files.length === 0
                  ? "ここにドロップ、またはクリックして選択（PDF / JPEG / PNG・複数可・各8MBまで）"
                  : `${files.length}件を選択中（ドロップ・クリックで追加できます）`}
              </label>
              {files.length > 0 && (
                <ul className="text-xs text-slate-600 space-y-1">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-1 min-w-0">
                      <span className="truncate">・{f.name}</span>
                      <button
                        type="button"
                        onClick={() => onFilesChange(files.filter((_, j) => j !== i))}
                        disabled={extracting}
                        className="shrink-0 text-slate-400 hover:text-red-600 disabled:opacity-50"
                        aria-label={`${f.name} を外す`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-slate-400">
                同じ表を分割したスクリーンショットはまとめてドロップしてください（自動で結合します）。読み取りには数分かかることがあります。
              </p>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={extracting}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => void handleExtract()}
                  disabled={files.length === 0 || extracting}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50 inline-flex items-center gap-2"
                >
                  {extracting && <FontAwesomeIcon icon={faSpinner} spin />}
                  {extracting ? "読み取り中…" : "読み取り開始"}
                </button>
              </div>

              {/* 直近の取り込み（バッチ取り消し） */}
              {batches.length > 0 && (
                <div className="border-t border-slate-200 pt-3">
                  <h3 className="text-xs font-semibold text-slate-500 mb-2">直近の取り込み</h3>
                  <ul className="space-y-1.5">
                    {batches.map((b) => (
                      <li key={b.id} className="flex items-center gap-2 text-xs text-slate-600">
                        <span className="truncate flex-1">
                          {new Date(b.created_at).toLocaleString("ja-JP", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          ・{b.registered}件（{b.sources.length}ファイル）
                        </span>
                        {b.reverted_at ? (
                          <span className="shrink-0 text-slate-400">取り消し済み</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleRevert(b.id, false)}
                            disabled={reverting !== null}
                            className="shrink-0 px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            {reverting === b.id ? "取り消し中…" : "取り消す"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            /* ステップ2: 検算・マッピング・プレビュー */
            <div className="space-y-5">
              {/* 検算（資料内の集計との突き合わせ）。内訳は折りたたみで情報量を抑える */}
              {(result.checks.dayTotals.length > 0 || mappedPersonTotals.length > 0) && (
                <div
                  className={`rounded-lg border px-4 py-3 text-xs ${
                    checkFailures === 0
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  <p className="font-medium">
                    <FontAwesomeIcon icon={checkFailures === 0 ? faCircleCheck : faTriangleExclamation} className="mr-1" />
                    資料内の集計との検算:
                    {result.checks.dayTotals.length > 0 &&
                      ` 日別人数 ${result.checks.dayTotals.filter((c) => c.ok).length}/${result.checks.dayTotals.length} 一致`}
                    {mappedPersonTotals.length > 0 &&
                      ` ・出勤日数 ${mappedPersonTotals.filter((c) => c.ok).length}/${mappedPersonTotals.length} 一致`}
                  </p>
                  {checkFailures > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer select-none">不一致の内訳（{checkFailures}件）</summary>
                      <ul className="list-disc pl-4 mt-1 max-h-28 overflow-y-auto space-y-0.5">
                        {result.checks.dayTotals
                          .filter((c) => !c.ok)
                          .map((c, i) => (
                            <li key={`d${i}`}>
                              {month}/{c.day} {c.label}: 表では{c.expected}人 / 読み取りは{c.actual}人
                            </li>
                          ))}
                        {mappedPersonTotals
                          .filter((c) => !c.ok)
                          .map((c, i) => (
                            <li key={`p${i}`}>
                              {c.name} の出勤日数: 表では{c.expected}日 / 読み取りは{c.actual}日
                            </li>
                          ))}
                      </ul>
                      <p className="mt-1 text-[10px] opacity-70">
                        ※出勤日数は表が半月分の場合、月合計と一致しないことがあります
                      </p>
                    </details>
                  )}
                </div>
              )}

              {result.warnings.length > 0 && (
                <details className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                  <summary className="cursor-pointer select-none font-medium">
                    読み取り時の注意（{result.warnings.length}件）
                  </summary>
                  <ul className="list-disc pl-4 mt-1 max-h-28 overflow-y-auto space-y-0.5">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}

              <section>
                <h3 className="text-sm font-semibold text-slate-800 mb-2">
                  勤務地・便ラベル → コース
                  {unmappedLabels.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-amber-600">未選択 {unmappedLabels.length}件</span>
                  )}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {result.labels.map((l) => (
                    <div key={l.label} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 truncate text-sm text-slate-700" title={l.label}>
                        {l.label}
                        {l.suggestionSource === "saved" && (
                          <FontAwesomeIcon
                            icon={faUserTag}
                            className="ml-1 text-[10px] text-sky-500"
                            title="前回の取り込みで確定した対応"
                          />
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <CustomSelect
                          size="sm"
                          options={courseOptions}
                          value={labelMap[l.label] || undefined}
                          placeholder="コースを選択"
                          onChange={(v) => setLabelMap((m) => ({ ...m, [l.label]: v }))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {result.labels.length === 0 && (
                  <p className="text-xs text-slate-400">勤務ラベルが見つかりませんでした。</p>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-800 mb-2">
                  読み取った名前 → ドライバー
                  {unmappedPeople.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      未選択 {unmappedPeople.length}名（未選択は取り込まれません）
                    </span>
                  )}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {result.people.map((p) => (
                    <div key={p.name} className="flex items-center gap-2">
                      <span
                        className="w-24 shrink-0 truncate text-sm text-slate-700"
                        title={`${p.name}（${p.sources.join(", ")}）`}
                      >
                        {p.name}
                        {p.suggestionSource === "saved" && (
                          <FontAwesomeIcon
                            icon={faUserTag}
                            className="ml-1 text-[10px] text-sky-500"
                            title="前回の取り込みで確定した対応"
                          />
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <CustomSelect
                          size="sm"
                          options={driverOptions}
                          value={personMap[p.name] || undefined}
                          placeholder="取り込まない"
                          onChange={(v) => setPersonMap((m) => ({ ...m, [p.name]: v }))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 突き合わせの警告（人違い・希望休・同日重複の自動解決・出勤同士の食い違い）。
                  ドライバーに紐付けた人の分だけ表示する */}
              {plan &&
                (plan.mismatchNotes.length > 0 ||
                  plan.offConflictNotes.length > 0 ||
                  plan.conflictNotes.length > 0 ||
                  mappedConflicts.length > 0) && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-xs text-orange-900 space-y-1">
                  <p className="font-medium">
                    <FontAwesomeIcon icon={faTriangleExclamation} className="mr-1" />
                    確認が必要な点:
                  </p>
                  <ul className="list-disc pl-4 max-h-36 overflow-y-auto space-y-0.5">
                    {plan.mismatchNotes.map((w, i) => (
                      <li key={`m${i}`} className="font-medium">{w}</li>
                    ))}
                    {plan.conflictNotes.map((c, i) => (
                      <li key={`c${i}`} className={c.confident ? "" : "font-medium"}>
                        {c.text}
                        {!c.confident && "【自動判定に自信なし・要確認】"}
                      </li>
                    ))}
                    {mappedConflicts.map((c, i) => (
                      <li key={`x${i}`}>
                        「{c.name}」 {month}/{c.day}: 別ファイルで「{c.kept}」と「{c.dropped}」が食い違い（「{c.kept}」を採用）
                      </li>
                    ))}
                    {plan.offConflictNotes.map((w, i) => (
                      <li key={`o${i}`}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* グリッドプレビュー（実際のシフト表と同じ 人×日 の形） */}
              {plan && plan.days.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-slate-800 mb-2">登録内容のプレビュー</h3>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="text-[11px] border-collapse min-w-full">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="sticky left-0 bg-slate-50 px-2 py-1 text-left font-medium text-slate-600 border-b border-slate-200 min-w-24">
                            名前
                          </th>
                          {plan.days.map((d) => (
                            <th key={d} className="px-1 py-1 font-medium text-slate-600 border-b border-l border-slate-200 min-w-9 text-center">
                              {d}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.people.map((p) => {
                          const mapped = Boolean(personMap[p.name]);
                          return (
                            <tr key={p.name} className={mapped ? "" : "opacity-40"}>
                              <td className="sticky left-0 bg-white px-2 py-1 text-slate-700 border-b border-slate-100 whitespace-nowrap">
                                {p.name}
                                {mapped && (
                                  <span className="text-slate-400"> → {driverName(personMap[p.name])}</span>
                                )}
                              </td>
                              {plan.days.map((d) => {
                                const raw = (p.days[d] ?? "").trim();
                                if (raw === "") {
                                  return <td key={d} className="border-b border-l border-slate-100" />;
                                }
                                const isWork = plan.workLabelSet.has(raw);
                                if (!isWork) {
                                  // 休みなどの非勤務ラベル
                                  return (
                                    <td key={d} className="border-b border-l border-slate-100 text-center text-slate-400">
                                      休
                                    </td>
                                  );
                                }
                                const mappedCourse = labelMap[raw];
                                const droppedByConflict = plan.droppedCells.has(`${p.name}|${d}`);
                                if (!mappedCourse) {
                                  return (
                                    <td key={d} className="border-b border-l border-slate-100 text-center bg-amber-100 text-amber-800" title={`未対応のラベル: ${raw}`}>
                                      {raw.slice(0, 2)}?
                                    </td>
                                  );
                                }
                                if (mappedCourse === IGNORE) {
                                  return (
                                    <td key={d} className="border-b border-l border-slate-100 text-center text-slate-300" title={`取り込まない: ${raw}`}>
                                      −
                                    </td>
                                  );
                                }
                                if (droppedByConflict || !mapped) {
                                  return (
                                    <td
                                      key={d}
                                      className="border-b border-l border-slate-100 text-center bg-red-50 text-red-400 line-through"
                                      title={droppedByConflict ? "同日重複のため除外（警告参照）" : "ドライバー未選択"}
                                    >
                                      {courseLabel(mappedCourse).slice(0, 3)}
                                    </td>
                                  );
                                }
                                const color = courseById.get(mappedCourse)?.color ?? "#94a3b8";
                                return (
                                  <td
                                    key={d}
                                    className="border-b border-l border-slate-100 text-center text-slate-800 whitespace-nowrap px-1"
                                    style={{ background: hexToRgba(color, 0.35) }}
                                    title={`${raw} → ${courseLabel(mappedCourse)}`}
                                  >
                                    {courseLabel(mappedCourse).slice(0, 3)}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">
                    色付き=登録される / 休・空欄=登録しない / 黄=コース未選択 / 赤=重複除外・ドライバー未選択
                  </p>
                </section>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={reset}
                  disabled={applying}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  やり直す
                </button>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600">
                    登録予定 <span className="font-semibold text-slate-900">{plan?.assignments.length ?? 0}</span> 件
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleApply()}
                    disabled={!plan || plan.assignments.length === 0 || applying}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {applying && <FontAwesomeIcon icon={faSpinner} spin />}
                    {applying ? "登録中…" : "一括登録"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
