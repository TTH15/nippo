"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faTrash,
  faImage,
  faCircleCheck,
  faTriangleExclamation,
  faXmark,
  faRotateLeft,
  faRotateRight,
  faArrowLeft,
} from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { Button } from "@/lib/ui/button";
import { apiFetch, apiUpload } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { hasCapability } from "@/lib/capabilities";
import {
  clusterSampleWords,
  isAnchorCandidate,
  suggestAnchors,
  suggestLocator,
  suggestRequiredAnchors,
  type AnchorSpec,
  type Box,
  type ImageTemplate,
  type ImageTemplateDefinition,
  type ReadTrust,
  type TemplateCheck,
  type TemplateField,
} from "@repo/core/logic/reportImageTemplate";
import { readReportImage, readSample, releaseReaders, type Rotation } from "@/lib/ocr/reportImageReader";
import { SampleBoard } from "./SampleBoard";

// ============================================================
// 原本画像の様式（どの画面の、どの位置に、どの報告項目の数字があるか）を決める。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-1）
//
// 画面は**手順どおりに上から進む1本の流れ**にする。
//   1 見本のスクショを登録する（向きは自動で起こす。読めた語も一緒に覚える）
//   2 見本の上で数字の欄を囲み、報告項目へ結ぶ
//   3 見分ける見出し（自動で選ぶ。直したいときだけ触る）
//   4 検算（合計＝内訳）
//   5 別のスクショで試す → 運用中にする
// 各段に「済み／未」を出し、運用中にできない理由はボタンの横に出す。
// ============================================================

type Field = { id: string; field_key: string; label: string; input_type: string };
type Unit = { id: string; name: string; fields: Field[] };
type Carrier = { id: string; name: string; units: Unit[] };

type TemplateRow = {
  id: string;
  carrier_id: string | null;
  template_key: string;
  version: number;
  name: string;
  status: "draft" | "active" | "retired";
  definition: ImageTemplateDefinition;
  sample_storage_path: string | null;
  sample_width: number | null;
  sample_height: number | null;
  note: string | null;
  updated_at: string;
};

type Verify = {
  score: number;
  level: string;
  trust: ReadTrust;
  rows: { label: string; value: string; status: string }[];
  warnings: string[];
};

const STATUS_LABEL: Record<TemplateRow["status"], string> = { draft: "編集中", active: "運用中", retired: "停止" };
const VALUE_TYPES = [
  { value: "int", label: "件数（整数）" },
  { value: "decimal", label: "数値（小数）" },
  { value: "time", label: "時刻" },
  { value: "date", label: "日付" },
];
const EMPTY_TRUST: ReadTrust = { level: "suspect", checksRun: 0, checksFailed: 0, incomplete: true, reasons: [] };

const emptyDefinition = (): ImageTemplateDefinition => ({
  match: { required: [], optional: [], minScore: 0.6 },
  fields: [],
  orientation: { rotate: 0 },
  sample: null,
});

/** 様式の識別子は人が考えるものではない。名前から機械が作る */
function templateKeyFromName(name: string, taken: readonly string[]): string {
  const base = `form-${Date.now().toString(36)}`;
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const candidate = /^[a-z0-9][a-z0-9_-]{1,59}$/.test(ascii) ? ascii : base;
  if (!taken.includes(candidate)) return candidate;
  return `${candidate.slice(0, 50)}-${Date.now().toString(36).slice(-4)}`;
}

/** 手順の見出し。済み／未を右に出す */
function Step({
  number,
  title,
  done,
  doneLabel,
  todoLabel,
  action,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  doneLabel: string;
  todoLabel: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
            done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
          }`}
        >
          {number}
        </span>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className={`text-[11px] font-medium ${done ? "text-emerald-700" : "text-slate-400"}`}>
          {done ? doneLabel : todoLabel}
        </span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export default function ReportImageTemplatesPage() {
  const [canWrite, setCanWrite] = useState(false);
  useEffect(() => setCanWrite(hasCapability("can_manage_carriers")), []);
  useEffect(() => () => void releaseReaders(), []);

  const { data, mutate, isInitialLoading } = useApi<{ templates: TemplateRow[]; unavailable?: boolean }>(
    "/api/admin/report-image-templates",
  );
  const { data: carrierData } = useApi<{ carriers: Carrier[] }>("/api/admin/carriers");
  const carriers = useMemo(() => carrierData?.carriers ?? [], [carrierData]);
  const templates = useMemo(() => data?.templates ?? [], [data]);

  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateRow | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [creating, setCreating] = useState<{ name: string } | null>(null);
  /** 今の画面で選んだ見本ファイル。向きを手で直すときに読み直す */
  const [lastSampleFile, setLastSampleFile] = useState<File | null>(null);
  const sampleInput = useRef<HTMLInputElement>(null);
  const verifyInput = useRef<HTMLInputElement>(null);

  // /admin/carriers から「このキャリアの様式」として開く
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setCarrierId(params.get("carrier"));
    const template = params.get("template");
    if (template) setSelectedId(template);
  }, []);

  const visible = useMemo(
    () => (carrierId ? templates.filter((template) => template.carrier_id === carrierId) : templates),
    [templates, carrierId],
  );
  const carrier = useMemo(() => carriers.find((row) => row.id === carrierId) ?? null, [carriers, carrierId]);
  const selected = useMemo(() => templates.find((t) => t.id === selectedId) ?? null, [templates, selectedId]);

  // 選ばれていなければ、このキャリアの最初の様式を開く
  useEffect(() => {
    if (!selectedId && visible.length > 0) setSelectedId(visible[0].id);
  }, [selectedId, visible]);

  useEffect(() => {
    setDraft(selected ? { ...selected } : null);
    setSelectedFieldId(null);
    setVerify(null);
    setLastSampleFile(null);
  }, [selected]);

  // 見本画像は非公開。開いている様式のぶんだけ短時間URLを取る
  useEffect(() => {
    let alive = true;
    setSampleUrl(null);
    if (!selected?.sample_storage_path) return;
    void apiFetch<{ url: string | null }>(`/api/admin/report-image-templates/sample?id=${selected.id}`)
      .then((response) => {
        if (alive) setSampleUrl(response.url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [selected?.id, selected?.sample_storage_path]);

  const patchDefinition = useCallback((patch: (definition: ImageTemplateDefinition) => ImageTemplateDefinition) => {
    setDraft((prev) => (prev ? { ...prev, definition: patch(prev.definition) } : prev));
  }, []);

  const sampleWords = draft?.definition.sample?.words ?? [];
  /** 見出しの欄を切り出して読み直した文字（あればこちらを見出しの元にする） */
  const sampleLabels = draft?.definition.sample?.labels ?? [];

  /** 見出しの候補（記号まみれの誤読は出さない） */
  const anchorCandidates = useMemo(() => {
    const source =
      sampleLabels.length > 0
        ? sampleLabels.map((label) => ({ text: label.text, box: label.box }))
        : clusterSampleWords(sampleWords);
    const seen = new Set<string>();
    return source.filter((line) => isAnchorCandidate(line.text) && !seen.has(line.text) && seen.add(line.text));
  }, [sampleWords, sampleLabels]);

  const anchorRole = (text: string): "required" | "optional" | "none" => {
    const match = draft?.definition.match;
    if (match?.required?.some((anchor) => anchor.text === text)) return "required";
    if (match?.optional?.some((anchor) => anchor.text === text)) return "optional";
    return "none";
  };

  const cycleAnchor = (candidate: { text: string; box: Box }) => {
    const role = anchorRole(candidate.text);
    const spec: AnchorSpec = { text: candidate.text, match: "fuzzy", sampleBox: candidate.box };
    patchDefinition((definition) => {
      const required = (definition.match.required ?? []).filter((a) => a.text !== candidate.text);
      const optional = (definition.match.optional ?? []).filter((a) => a.text !== candidate.text);
      if (role === "none") required.push(spec);
      else if (role === "required") optional.push(spec);
      return { ...definition, match: { ...definition.match, required, optional } };
    });
  };

  const entries = (draft?.definition.fields ?? []).filter((field) => (field.role ?? "entry") === "entry");
  const unitOptions = carriers
    .filter((c) => !draft?.carrier_id || c.id === draft.carrier_id)
    .flatMap((c) => c.units.map((unit) => ({ value: unit.id, label: unit.name, unit })));

  // --- 手順の済み／未 ---
  const hasSample = !!draft?.definition.sample && !!draft?.sample_storage_path;
  const boundEntries = entries.filter((field) => field.unitId && field.fieldKey);
  const fieldsDone = entries.length > 0 && boundEntries.length === entries.length;
  const anchorsDone = (draft?.definition.match.required?.length ?? 0) > 0;
  const checksCount = draft?.definition.checks?.length ?? 0;
  const verified = verify != null && verify.level !== "none";
  const activationBlockers: string[] = [];
  if (!hasSample) activationBlockers.push("見本を登録してください");
  if (entries.length === 0) activationBlockers.push("読み取る項目を囲んでください");
  else if (!fieldsDone) activationBlockers.push("報告項目を選んでいない項目があります");
  if (!anchorsDone) activationBlockers.push("見分ける見出しがありません");

  // --- 項目 ---
  const addField = (rect: Box) => {
    const id = `f${Date.now().toString(36)}`;
    const anchors = suggestAnchors(rect, sampleWords, sampleLabels);
    const locator = suggestLocator(rect, sampleWords, sampleLabels);
    const field: TemplateField = {
      id,
      role: "entry",
      unitId: "",
      fieldKey: "",
      label: anchors.row?.text
        ? `${anchors.row.text} ${anchors.column?.text ?? ""}`.trim()
        : `項目${(draft?.definition.fields.length ?? 0) + 1}`,
      value: { type: "int", min: 0, max: 9999 },
      locator,
      required: true,
    };
    patchDefinition((definition) => ({ ...definition, fields: [...definition.fields, field] }));
    setSelectedFieldId(id);
  };

  const patchField = (id: string, patch: Partial<TemplateField>) => {
    patchDefinition((definition) => ({
      ...definition,
      fields: definition.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    }));
  };

  const removeField = (id: string) => {
    patchDefinition((definition) => ({
      ...definition,
      fields: definition.fields.filter((field) => field.id !== id),
      checks: (definition.checks ?? []).filter((check) => check.totalFieldId !== id && !check.partFieldIds.includes(id)),
    }));
  };

  // --- 検算 ---
  const addCheck = () => {
    if (entries.length < 2 && (draft?.definition.fields.length ?? 0) < 2) return;
    const all = draft?.definition.fields ?? [];
    patchDefinition((definition) => ({
      ...definition,
      checks: [...(definition.checks ?? []), { kind: "sum", totalFieldId: all[0].id, partFieldIds: [] }],
    }));
  };
  const patchCheck = (index: number, patch: Partial<TemplateCheck>) => {
    patchDefinition((definition) => ({
      ...definition,
      checks: (definition.checks ?? []).map((check, i) => (i === index ? { ...check, ...patch } : check)),
    }));
  };
  const removeCheck = (index: number) => {
    patchDefinition((definition) => ({ ...definition, checks: (definition.checks ?? []).filter((_, i) => i !== index) }));
  };

  // --- 保存・作成 ---
  const save = async (patch: Partial<TemplateRow> = {}) => {
    if (!draft) return;
    setBusy("保存中…");
    try {
      await apiFetch("/api/admin/report-image-templates", {
        method: "PATCH",
        body: JSON.stringify({
          id: draft.id,
          name: draft.name,
          carrierId: draft.carrier_id,
          note: draft.note,
          definition: draft.definition,
          ...patch,
        }),
      });
      await mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!creating || !carrierId) return;
    setBusy("作成中…");
    try {
      const response = await apiFetch<{ template: TemplateRow }>("/api/admin/report-image-templates", {
        method: "POST",
        body: JSON.stringify({
          templateKey: templateKeyFromName(creating.name, templates.map((row) => row.template_key)),
          name: creating.name,
          carrierId,
          definition: emptyDefinition(),
        }),
      });
      await mutate();
      setCreating(null);
      setSelectedId(response.template.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "様式を作成できませんでした");
    } finally {
      setBusy(null);
    }
  };

  /**
   * 見本を登録する。向きは自動で起こし（rotate を渡せば固定）、起こした画像を見本として保存する。
   * 見本の座標系と表示が同じになるので、囲んだ枠がそのまま読み取り位置になる。
   */
  const registerSample = async (file: File, rotate?: Rotation) => {
    if (!draft) return;
    setBusy("見本を読んでいます");
    try {
      const reading = await readSample(file, rotate);
      const form = new FormData();
      form.append("id", draft.id);
      form.append("file", new File([reading.uprightBlob], "sample.jpg", { type: "image/jpeg" }));
      form.append("width", String(reading.sample.width));
      form.append("height", String(reading.sample.height));
      await apiUpload("/api/admin/report-image-templates/sample", form);

      const required = suggestRequiredAnchors(reading.sample.words, 3, reading.sample.labels);
      const definition: ImageTemplateDefinition = {
        ...draft.definition,
        orientation: { rotate: reading.rotate },
        sample: reading.sample,
        // 見本を差し替えたら見出しは選び直す（前の見本の座標は使えない）
        match: { ...draft.definition.match, required, optional: [] },
      };
      await apiFetch("/api/admin/report-image-templates", {
        method: "PATCH",
        body: JSON.stringify({ id: draft.id, definition }),
      });
      setLastSampleFile(file);
      await mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "見本を読めませんでした");
    } finally {
      setBusy(null);
      if (sampleInput.current) sampleInput.current.value = "";
    }
  };

  const rotateSample = (direction: -90 | 90) => {
    if (!lastSampleFile || !draft) return;
    const current = draft.definition.orientation?.rotate ?? 0;
    const next = (((current + direction) % 360) + 360) % 360;
    void registerSample(lastSampleFile, next as Rotation);
  };

  /** 別のスクショで試す。運用中にする前にここで確かめる */
  const runVerify = async (file: File) => {
    if (!draft) return;
    setBusy("試しています");
    try {
      const template: ImageTemplate = {
        key: draft.template_key,
        version: String(draft.version),
        name: draft.name,
        carrierId: draft.carrier_id,
        definition: draft.definition,
      };
      const outcome = await readReportImage(file, [template]);
      if (!outcome.result) {
        setVerify({ score: 0, level: "none", trust: EMPTY_TRUST, rows: [], warnings: ["この画像はこの様式として読めません"] });
        return;
      }
      setVerify({
        score: outcome.result.match.score,
        level: outcome.result.match.level,
        trust: outcome.result.trust,
        rows: outcome.result.fields.map((field) => ({
          label: field.label,
          value: field.value == null ? "—" : String(field.value),
          status: field.status,
        })),
        warnings: outcome.result.warnings,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "試せませんでした");
    } finally {
      setBusy(null);
      if (verifyInput.current) verifyInput.current.value = "";
    }
  };

  const boardFields = (draft?.definition.fields ?? [])
    .map((field, index) => {
      const rect =
        field.locator.kind === "region"
          ? field.locator.rect
          : field.locator.kind === "anchor"
            ? (field.locator.valueHint ?? null)
            : null;
      return rect ? { id: field.id, label: `${index + 1}`, rect } : null;
    })
    .filter((entry): entry is { id: string; label: string; rect: Box } => entry !== null);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link href="/admin/carriers" className="text-xs text-slate-500 hover:text-slate-800">
            <FontAwesomeIcon icon={faArrowLeft} className="mr-1 h-3 w-3" />
            {carrier ? `${carrier.name}の設定` : "キャリア／フォーム設計"}
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <FontAwesomeIcon icon={faImage} className="h-5 w-5 text-slate-400" />
            画像の様式
          </h1>
        </div>

        {data?.unavailable && (
          <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <FontAwesomeIcon icon={faTriangleExclamation} className="mr-2 h-3.5 w-3.5" />
            様式の保存先がまだ用意できていません（migration 181）
          </p>
        )}

        {/* 同じキャリアに様式が複数あるときだけ切り替えを出す */}
        {(visible.length > 1 || canWrite) && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {visible.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setSelectedId(template.id)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  template.id === selectedId
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
                }`}
              >
                {template.name}
                <span className="ml-1 opacity-70">第{template.version}版・{STATUS_LABEL[template.status]}</span>
              </button>
            ))}
            {canWrite && carrierId && (
              <button
                type="button"
                onClick={() => setCreating({ name: "" })}
                className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-slate-500"
              >
                <FontAwesomeIcon icon={faPlus} className="mr-1 h-3 w-3" />
                様式を追加
              </button>
            )}
          </div>
        )}

        {isInitialLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !draft ? (
          <p className="rounded-lg border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400">
            {carrierId ? "この荷主の様式はまだありません" : "キャリア設定の「画像の様式」から開いてください"}
          </p>
        ) : (
          <div className="space-y-4">
            {/* 名前・状態・保存 */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className="h-10 w-full flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                  aria-label="様式の名前"
                  placeholder="配達集計精算書"
                  disabled={!canWrite}
                />
                <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                  {carrier?.name ?? "荷主未設定"}・第{draft.version}版・{STATUS_LABEL[draft.status]}
                </span>
                {canWrite && (
                  <Button variant="outline" size="sm" disabled={busy != null} onClick={() => void save()}>
                    {busy ?? "保存"}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              {/* 左: 見本（作業台） */}
              <div className="space-y-4">
                <Step
                  number={1}
                  title="見本のスクショ"
                  done={hasSample}
                  doneLabel={`登録済み${(draft.definition.orientation?.rotate ?? 0) !== 0 ? `・${draft.definition.orientation?.rotate}°起こして表示` : ""}`}
                  todoLabel="未登録"
                  action={
                    canWrite && (
                      <div className="flex items-center gap-1">
                        {lastSampleFile && hasSample && (
                          <>
                            <Button variant="ghost" size="sm" aria-label="左に回す" disabled={busy != null} onClick={() => rotateSample(-90)}>
                              <FontAwesomeIcon icon={faRotateLeft} className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" aria-label="右に回す" disabled={busy != null} onClick={() => rotateSample(90)}>
                              <FontAwesomeIcon icon={faRotateRight} className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        <Button variant={hasSample ? "ghost" : "default"} size="sm" disabled={busy != null} onClick={() => sampleInput.current?.click()}>
                          <FontAwesomeIcon icon={faImage} className="h-3.5 w-3.5" />
                          {busy === "見本を読んでいます" ? busy : hasSample ? "差し替える" : "スクショを選ぶ"}
                        </Button>
                      </div>
                    )
                  }
                >
                  <input
                    ref={sampleInput}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void registerSample(file);
                    }}
                  />
                  {sampleUrl && draft.definition.sample ? (
                    <>
                      <SampleBoard
                        url={sampleUrl}
                        width={draft.definition.sample.width}
                        height={draft.definition.sample.height}
                        fields={boardFields}
                        selectedId={selectedFieldId}
                        onSelect={setSelectedFieldId}
                        onDraw={addField}
                        readOnly={!canWrite}
                      />
                      {canWrite && (
                        <p className="mt-2 text-[11px] text-slate-500">
                          {entries.length === 0 ? "数字の欄をドラッグで囲む" : "囲むと項目が増える。番号は右の一覧と対応"}
                        </p>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={!canWrite || busy != null}
                      onClick={() => sampleInput.current?.click()}
                      className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-14 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-60"
                    >
                      <FontAwesomeIcon icon={faImage} className="h-6 w-6 text-slate-300" />
                      配完表などのスクショを選ぶ
                    </button>
                  )}
                </Step>
              </div>

              {/* 右: 手順 2〜5 */}
              <div className="space-y-4">
                <Step
                  number={2}
                  title="読み取る項目"
                  done={fieldsDone}
                  doneLabel={`${boundEntries.length}件`}
                  todoLabel={entries.length === 0 ? "見本の上で数字を囲む" : `${entries.length - boundEntries.length}件が未設定`}
                >
                  {draft.definition.fields.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">{hasSample ? "左の見本で数字の欄を囲む" : "先に見本を登録する"}</p>
                  ) : (
                    <ul className="space-y-2">
                      {draft.definition.fields.map((field, index) => {
                        const unit = unitOptions.find((option) => option.value === field.unitId)?.unit;
                        const isCheck = (field.role ?? "entry") === "check";
                        const anchorLocator = field.locator.kind === "anchor" ? field.locator : null;
                        const regionLocator = field.locator.kind === "region" ? field.locator : null;
                        const anchorChips: { side: "row" | "column"; anchor: AnchorSpec }[] = [];
                        if (anchorLocator) anchorChips.push({ side: "row", anchor: anchorLocator.anchor });
                        if (regionLocator?.row) anchorChips.push({ side: "row", anchor: regionLocator.row });
                        if (regionLocator?.column) anchorChips.push({ side: "column", anchor: regionLocator.column });
                        return (
                          <li
                            key={field.id}
                            className={`space-y-2 rounded-lg border p-2 ${field.id === selectedFieldId ? "border-sky-400 bg-sky-50/40" : "border-slate-200"}`}
                            onPointerDown={() => setSelectedFieldId(field.id)}
                          >
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold text-white">
                                {index + 1}
                              </span>
                              <input
                                value={field.label}
                                onChange={(event) => patchField(field.id, { label: event.target.value })}
                                className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm"
                                aria-label="項目の名前"
                                disabled={!canWrite}
                              />
                              <div className="w-32 shrink-0">
                                <CustomSelect
                                  value={field.value.type}
                                  onChange={(value) =>
                                    patchField(field.id, {
                                      value: { ...field.value, type: value as TemplateField["value"]["type"] },
                                      role: value === "date" ? "date" : isCheck ? "check" : "entry",
                                    })
                                  }
                                  options={VALUE_TYPES}
                                  ariaLabel="値の種類"
                                  size="sm"
                                  clearable={false}
                                  disabled={!canWrite}
                                />
                              </div>
                              {canWrite && (
                                <button
                                  type="button"
                                  aria-label={`${field.label}を消す`}
                                  onClick={() => removeField(field.id)}
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                                >
                                  <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            {(field.role ?? "entry") !== "date" && (
                              <div className="flex flex-wrap items-center gap-2 pl-8">
                                {!isCheck && (
                                  <>
                                    <div className="w-44">
                                      <CustomSelect
                                        value={field.unitId}
                                        onChange={(value) => patchField(field.id, { unitId: value, fieldKey: "" })}
                                        options={[{ value: "", label: "報告単位" }, ...unitOptions.map(({ value, label }) => ({ value, label }))]}
                                        ariaLabel="報告単位"
                                        size="sm"
                                        clearable={false}
                                        disabled={!canWrite}
                                      />
                                    </div>
                                    <div className="w-40">
                                      <CustomSelect
                                        value={field.fieldKey}
                                        onChange={(value) => patchField(field.id, { fieldKey: value })}
                                        options={[
                                          { value: "", label: "報告項目" },
                                          ...(unit?.fields ?? []).map((f) => ({ value: f.field_key, label: f.label })),
                                        ]}
                                        ariaLabel="報告項目"
                                        size="sm"
                                        clearable={false}
                                        disabled={!canWrite}
                                      />
                                    </div>
                                  </>
                                )}
                                <CheckboxField
                                  checked={isCheck}
                                  onCheckedChange={(checked) =>
                                    patchField(field.id, {
                                      role: checked ? "check" : "entry",
                                      ...(checked ? { unitId: "", fieldKey: "", required: false } : { required: true }),
                                    })
                                  }
                                  label="検算にだけ使う"
                                  disabled={!canWrite}
                                />
                              </div>
                            )}

                            {anchorChips.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 pl-8">
                                {anchorChips.map(({ side, anchor }) => (
                                  <span
                                    key={side}
                                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600"
                                  >
                                    {side === "row" ? "行" : "列"}:
                                    <input
                                      value={anchor.text}
                                      onChange={(event) => {
                                        const text = event.target.value;
                                        if (anchorLocator) patchField(field.id, { locator: { ...anchorLocator, anchor: { ...anchor, text } } });
                                        else if (regionLocator) patchField(field.id, { locator: { ...regionLocator, [side]: { ...anchor, text } } });
                                      }}
                                      disabled={!canWrite}
                                      aria-label={`${side === "row" ? "行" : "列"}の見出し`}
                                      className="w-24 rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]"
                                    />
                                    {canWrite && (
                                      <button
                                        type="button"
                                        aria-label={`${anchor.text}を手がかりにしない`}
                                        onClick={() => {
                                          if (regionLocator) patchField(field.id, { locator: { ...regionLocator, [side]: null } });
                                          else if (anchorLocator) {
                                            // 見出し相対の欄は見出しが無いと成り立たない。座標の欄に切り替える
                                            patchField(field.id, {
                                              locator: { kind: "region", rect: anchorLocator.valueHint ?? { x: 0, y: 0, w: 1, h: 1 } },
                                            });
                                          }
                                        }}
                                        className="text-slate-400 hover:text-slate-700"
                                      >
                                        <FontAwesomeIcon icon={faXmark} className="h-2.5 w-2.5" />
                                      </button>
                                    )}
                                  </span>
                                ))}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Step>

                <Step
                  number={3}
                  title="見分ける見出し"
                  done={anchorsDone}
                  doneLabel={`${draft.definition.match.required?.length ?? 0}件（自動で選択）`}
                  todoLabel="未選択"
                >
                  {anchorCandidates.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">{hasSample ? "見本から読めた見出しがありません" : "先に見本を登録する"}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {anchorCandidates.map((candidate) => {
                        const role = anchorRole(candidate.text);
                        return (
                          <button
                            key={`${candidate.text}-${candidate.box.y}`}
                            type="button"
                            disabled={!canWrite}
                            onClick={() => cycleAnchor(candidate)}
                            className={`rounded border px-1.5 py-0.5 text-[11px] ${
                              role === "required"
                                ? "border-sky-500 bg-sky-50 text-sky-800"
                                : role === "optional"
                                  ? "border-slate-400 bg-slate-50 text-slate-700"
                                  : "border-slate-200 text-slate-500"
                            }`}
                          >
                            {candidate.text}
                            {role === "required" && "・必須"}
                            {role === "optional" && "・任意"}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Step>

                <Step
                  number={4}
                  title="検算（合計＝内訳）"
                  done={checksCount > 0}
                  doneLabel={`${checksCount}本`}
                  todoLabel="無くても動く。あれば確認を省ける"
                  action={
                    canWrite &&
                    (draft.definition.fields.length >= 2 ? (
                      <Button variant="ghost" size="sm" onClick={addCheck}>
                        <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
                        式を足す
                      </Button>
                    ) : null)
                  }
                >
                  {(draft.definition.checks ?? []).length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">
                      {draft.definition.fields.length >= 2 ? "合計の欄と内訳の欄があるなら式を足す" : "項目が2つ以上になると足せる"}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {(draft.definition.checks ?? []).map((check, index) => {
                        const all = draft.definition.fields;
                        return (
                          <li key={`${check.totalFieldId}-${index}`} className="space-y-1.5 rounded-lg border border-slate-200 p-2">
                            <div className="flex items-center gap-2">
                              <div className="w-44">
                                <CustomSelect
                                  value={check.totalFieldId}
                                  onChange={(value) => patchCheck(index, { totalFieldId: value })}
                                  options={all.map((field) => ({ value: field.id, label: field.label }))}
                                  ariaLabel="合計の項目"
                                  size="sm"
                                  clearable={false}
                                  disabled={!canWrite}
                                />
                              </div>
                              <span className="text-xs text-slate-500">＝ 内訳の和</span>
                              {canWrite && (
                                <button
                                  type="button"
                                  aria-label="この検算を消す"
                                  onClick={() => removeCheck(index)}
                                  className="ml-auto flex h-9 w-9 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                                >
                                  <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {all
                                .filter((field) => field.id !== check.totalFieldId)
                                .map((field) => {
                                  const on = check.partFieldIds.includes(field.id);
                                  return (
                                    <button
                                      key={field.id}
                                      type="button"
                                      disabled={!canWrite}
                                      onClick={() =>
                                        patchCheck(index, {
                                          partFieldIds: on
                                            ? check.partFieldIds.filter((id) => id !== field.id)
                                            : [...check.partFieldIds, field.id],
                                        })
                                      }
                                      className={`rounded border px-1.5 py-0.5 text-[11px] ${
                                        on ? "border-sky-500 bg-sky-50 text-sky-800" : "border-slate-200 text-slate-500"
                                      }`}
                                    >
                                      {field.label}
                                    </button>
                                  );
                                })}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Step>

                <Step
                  number={5}
                  title="別のスクショで試す"
                  done={verified}
                  doneLabel={verify?.trust.level === "verified" ? "自動で確定できる" : "読める（本人の確認あり）"}
                  todoLabel="未確認"
                  action={
                    <Button variant={verified ? "ghost" : "outline"} size="sm" disabled={busy != null || !hasSample} onClick={() => verifyInput.current?.click()}>
                      {busy === "試しています" ? busy : "画像を選ぶ"}
                    </Button>
                  }
                >
                  <input
                    ref={verifyInput}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void runVerify(file);
                    }}
                  />
                  {!verify ? (
                    <p className="py-4 text-center text-xs text-slate-400">別の日のスクショで、同じ値が読めるか確かめる</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-slate-600">
                          一致 {Math.round(verify.score * 100)}%
                          {verify.level === "high" && "・読み取り可"}
                          {verify.level === "low" && "・要確認"}
                          {verify.level === "none" && "・未対応"}
                        </p>
                        {verify.trust.level === "verified" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            <FontAwesomeIcon icon={faCircleCheck} className="h-3 w-3" />
                            自動で確定できる（式 {verify.trust.checksRun}本）
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                            本人の確認が要る
                          </span>
                        )}
                      </div>
                      {verify.trust.reasons.map((reason) => (
                        <p key={reason} className="text-[11px] text-amber-700">{reason}</p>
                      ))}
                      <ul className="divide-y divide-slate-100 text-xs">
                        {verify.rows.map((row) => (
                          <li key={row.label} className="flex items-center justify-between gap-2 py-1">
                            <span className="truncate text-slate-700">{row.label}</span>
                            <span className="flex items-center gap-1 tabular-nums text-slate-900">
                              {row.value}
                              {row.status === "read" && <FontAwesomeIcon icon={faCircleCheck} className="h-3 w-3 text-emerald-600" />}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {verify.warnings.map((warning) => (
                        <p key={warning} className="text-[11px] text-amber-700">{warning}</p>
                      ))}
                    </div>
                  )}
                </Step>

                {/* 運用中にする。できない理由は横に出す */}
                {canWrite && (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                    {draft.status !== "active" ? (
                      <Button disabled={busy != null || activationBlockers.length > 0} onClick={() => void save({ status: "active" })}>
                        運用中にする
                      </Button>
                    ) : (
                      <Button variant="outline" disabled={busy != null} onClick={() => void save({ status: "retired" })}>
                        停止する
                      </Button>
                    )}
                    {draft.status !== "active" && activationBlockers.length > 0 && (
                      <ul className="text-[11px] text-slate-500">
                        {activationBlockers.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    )}
                    {draft.status !== "active" && activationBlockers.length === 0 && !verified && (
                      <span className="text-[11px] text-slate-500">試してからにすると安心</span>
                    )}
                    {draft.status === "draft" && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirm({
                            message: `${draft.name}を消します。よろしいですか。`,
                            onConfirm: async () => {
                              setConfirm(null);
                              try {
                                await apiFetch(`/api/admin/report-image-templates?id=${draft.id}`, { method: "DELETE" });
                                setSelectedId(null);
                                await mutate();
                              } catch (e) {
                                setError(e instanceof Error ? e.message : "消せませんでした");
                              }
                            },
                          })
                        }
                        className="ml-auto text-[11px] text-red-600 hover:underline"
                      >
                        <FontAwesomeIcon icon={faTrash} className="mr-1 h-3 w-3" />
                        この様式を消す
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {creating && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreating(null)}>
            <div className="w-full max-w-sm space-y-3 rounded-lg bg-white p-4" onClick={(event) => event.stopPropagation()}>
              <h2 className="text-sm font-semibold text-slate-900">{carrier ? `${carrier.name}の様式を追加` : "様式を追加"}</h2>
              <input
                value={creating.name}
                onChange={(event) => setCreating({ name: event.target.value })}
                placeholder="配達集計精算書"
                autoFocus
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
                aria-label="様式の名前"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && creating.name && carrierId) void create();
                }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setCreating(null)}>
                  やめる
                </Button>
                <Button disabled={!creating.name || !carrierId || busy != null} onClick={() => void create()}>
                  作成
                </Button>
              </div>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={confirm != null}
          message={confirm?.message ?? ""}
          tone="danger"
          onConfirm={() => confirm?.onConfirm()}
          onClose={() => setConfirm(null)}
        />
        <ErrorDialog open={error != null} message={error ?? ""} onClose={() => setError(null)} />
      </div>
    </AdminLayout>
  );
}
