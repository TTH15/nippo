"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faTrash, faImage, faCircleCheck, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { Skeleton } from "@/lib/components/Skeleton";
import { ErrorDialog } from "@/lib/components/ErrorDialog";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { Button } from "@/lib/ui/button";
import Link from "next/link";
import { apiFetch, apiUpload } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { hasCapability } from "@/lib/capabilities";
import {
  buildLines,
  type AnchorSpec,
  type Box,
  type ImageTemplate,
  type ImageTemplateDefinition,
  type OcrWord,
  type TemplateCheck,
  type TemplateField,
  suggestAnchors,
  suggestLocator,
} from "@repo/core/logic/reportImageTemplate";
import { readReportImage, readSample, releaseReaders, type Rotation } from "@/lib/ocr/reportImageReader";
import { SampleBoard } from "./SampleBoard";

// ============================================================
// 原本画像の様式（どの画面の、どの位置に、どの報告項目の数字があるか）を決める。
// 設計: docs/design/report-image-evidence-2026-09.md（RIMG-1）
//
// 形式が増えるたびにコードを書かないための画面。見本画像に枠を引いて報告項目へ結び付け、
// 別のスクショで試してから運用中にする。読み取りは端末の中だけで行う。
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

const STATUS_LABEL: Record<TemplateRow["status"], string> = { draft: "編集中", active: "運用中", retired: "停止" };
const VALUE_TYPES = [
  { value: "int", label: "件数（整数）" },
  { value: "decimal", label: "数値（小数）" },
  { value: "time", label: "時刻" },
  { value: "date", label: "日付" },
];
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateRow | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [verify, setVerify] = useState<{
    score: number;
    level: string;
    trust: { level: string; checksRun: number; checksFailed: number; reasons: string[] };
    rows: { label: string; value: string; status: string }[];
    warnings: string[];
  } | null>(null);
  const [creating, setCreating] = useState<{ name: string } | null>(null);
  /** どのキャリアの画面を扱っているか。キャリア設定からの遷移で決まる */
  const [carrierId, setCarrierId] = useState<string | null>(null);
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

  useEffect(() => {
    setDraft(selected ? { ...selected } : null);
    setSelectedFieldId(null);
    setVerify(null);
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

  /** 見本を読んだときの語から、見出しの候補を作る */
  const anchorCandidates = useMemo(() => {
    const words = draft?.definition.sample?.words ?? [];
    if (words.length === 0) return [] as { text: string; box: Box }[];
    const asWords: OcrWord[] = words.map((word) => ({ text: word.text, ...word.box }));
    return buildLines(asWords)
      .map((line) => ({ text: line.words.map((w) => w.text).join(""), box: line.box }))
      .filter((line) => line.text.replace(/\s/g, "").length >= 2);
  }, [draft?.definition.sample?.words]);

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

  const addField = (rect: Box) => {
    const id = `f${Date.now().toString(36)}`;
    // 欄の上と左にある見出しを一緒に覚えておく。相手の画面が変わっても欄を追い直せる。
    // 数字や、他の見出しに紛れる語は選ばない（隣の欄へ吸い寄せられる原因になる）
    const sampleWords = draft?.definition.sample?.words ?? [];
    const anchors = suggestAnchors(rect, sampleWords);
    const locator = suggestLocator(rect, sampleWords);
    const field: TemplateField = {
      id,
      role: "entry",
      unitId: "",
      fieldKey: "",
      label: anchors.row?.text ? `${anchors.row.text} ${anchors.column?.text ?? ""}`.trim() : `項目${(draft?.definition.fields.length ?? 0) + 1}`,
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
      checks: (definition.checks ?? []).filter(
        (check) => check.totalFieldId !== id && !check.partFieldIds.includes(id),
      ),
    }));
  };

  const addCheck = () => {
    const entries = (draft?.definition.fields ?? []).filter((field) => (field.role ?? "entry") === "entry");
    if (entries.length < 2) return;
    patchDefinition((definition) => ({
      ...definition,
      checks: [...(definition.checks ?? []), { kind: "sum", totalFieldId: entries[0].id, partFieldIds: [] }],
    }));
  };

  const patchCheck = (index: number, patch: Partial<TemplateCheck>) => {
    patchDefinition((definition) => ({
      ...definition,
      checks: (definition.checks ?? []).map((check, i) => (i === index ? { ...check, ...patch } : check)),
    }));
  };

  const removeCheck = (index: number) => {
    patchDefinition((definition) => ({
      ...definition,
      checks: (definition.checks ?? []).filter((_, i) => i !== index),
    }));
  };

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
          // 識別子は名前から作る。運営に内部の値を考えさせない
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

  /** 見本を読み込む。向きは全部試して、いちばん文字が取れた角度を採る */
  const uploadSample = async (file: File) => {
    if (!draft) return;
    setBusy("見本を読んでいます");
    try {
      let best: { rotate: Rotation; words: number; sample: NonNullable<ImageTemplateDefinition["sample"]> } | null = null;
      for (const rotate of ROTATIONS) {
        const { sample } = await readSample(file, rotate);
        const words = sample.words.length;
        if (!best || words > best.words) best = { rotate, words, sample };
      }
      if (!best) throw new Error("見本を読めませんでした");

      const form = new FormData();
      form.append("id", draft.id);
      form.append("file", file);
      form.append("width", String(best.sample.width));
      form.append("height", String(best.sample.height));
      await apiUpload("/api/admin/report-image-templates/sample", form);

      const definition: ImageTemplateDefinition = {
        ...draft.definition,
        orientation: { rotate: best.rotate },
        sample: best.sample,
        // 見本を差し替えたら、前の見本の座標で作った見出しは使えない
        match: { ...draft.definition.match, required: [], optional: [] },
      };
      setDraft((prev) => (prev ? { ...prev, definition } : prev));
      await apiFetch("/api/admin/report-image-templates", {
        method: "PATCH",
        body: JSON.stringify({ id: draft.id, definition }),
      });
      await mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "見本を読めませんでした");
    } finally {
      setBusy(null);
      if (sampleInput.current) sampleInput.current.value = "";
    }
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
        setVerify({
          score: 0,
          level: "none",
          trust: { level: "needs_check", checksRun: 0, checksFailed: 0, reasons: [] },
          rows: [],
          warnings: ["この画像はこの様式として読めません"],
        });
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

  const unitOptions = carriers
    .filter((carrier) => !draft?.carrier_id || carrier.id === draft.carrier_id)
    .flatMap((carrier) => carrier.units.map((unit) => ({ value: unit.id, label: `${carrier.name} / ${unit.name}`, unit })));

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <FontAwesomeIcon icon={faImage} className="h-5 w-5 text-slate-400" />
          画像の様式
        </h1>
        {carrier && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{carrier.name}</span>}
        <Link href="/admin/carriers" className="ml-auto text-xs text-slate-500 hover:text-slate-800">
          キャリア／フォーム設計へ戻る
        </Link>
      </div>
      {data?.unavailable && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <FontAwesomeIcon icon={faTriangleExclamation} className="mr-2 h-3.5 w-3.5" />
          様式の保存先がまだ用意できていません（migration 181）
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-2">
          {canWrite && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setCreating({ name: "" })}
            >
              <FontAwesomeIcon icon={faPlus} className="h-3.5 w-3.5" />
              様式を追加
            </Button>
          )}
          {isInitialLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {visible.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(template.id)}
                    className={`w-full px-3 py-2.5 text-left ${template.id === selectedId ? "bg-slate-50" : ""}`}
                  >
                    <span className="block truncate text-sm text-slate-800">{template.name}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      第{template.version}版・{STATUS_LABEL[template.status]}
                    </span>
                  </button>
                </li>
              ))}
              {visible.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-400">様式がありません</li>}
            </ul>
          )}
        </aside>

        <section className="space-y-4">
          {!draft ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-16 text-center text-sm text-slate-400">
              様式を選んでください
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className="h-10 min-w-48 flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                  aria-label="様式の名前"
                  disabled={!canWrite}
                />
                <CustomSelect
                  value={draft.carrier_id ?? ""}
                  onChange={(value) => setDraft({ ...draft, carrier_id: value || null })}
                  options={carriers.map((c) => ({ value: c.id, label: c.name }))}
                  className="h-10 w-48"
                />
                <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                  第{draft.version}版・{STATUS_LABEL[draft.status]}
                </span>
                {canWrite && (
                  <>
                    <Button variant="outline" disabled={busy != null} onClick={() => void save()}>
                      {busy ?? "保存"}
                    </Button>
                    {draft.status !== "active" ? (
                      <Button disabled={busy != null} onClick={() => void save({ status: "active" })}>
                        運用中にする
                      </Button>
                    ) : (
                      <Button variant="outline" disabled={busy != null} onClick={() => void save({ status: "retired" })}>
                        停止する
                      </Button>
                    )}
                  </>
                )}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-slate-800">見本と読み取り位置</h3>
                    {canWrite && (
                      <Button variant="ghost" size="sm" disabled={busy != null} onClick={() => sampleInput.current?.click()}>
                        <FontAwesomeIcon icon={faImage} className="h-3.5 w-3.5" />
                        見本を選ぶ
                      </Button>
                    )}
                  </div>
                  <input
                    ref={sampleInput}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadSample(file);
                    }}
                  />
                  {sampleUrl && draft.definition.sample ? (
                    <SampleBoard
                      url={sampleUrl}
                      width={draft.definition.sample.width}
                      height={draft.definition.sample.height}
                      fields={draft.definition.fields
                        .map((field) => {
                          const rect =
                            field.locator.kind === "region"
                              ? field.locator.rect
                              : field.locator.kind === "anchor"
                                ? (field.locator.valueHint ?? null)
                                : null;
                          return rect ? { id: field.id, label: field.label, rect } : null;
                        })
                        .filter((entry): entry is { id: string; label: string; rect: Box } => entry !== null)}
                      selectedId={selectedFieldId}
                      onSelect={setSelectedFieldId}
                      onDraw={addField}
                      readOnly={!canWrite}
                    />
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-xs text-slate-400">
                      見本の画像がありません
                    </p>
                  )}

                  {anchorCandidates.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-600">見分ける見出し</p>
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
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                    <h3 className="text-sm font-medium text-slate-800">読み取る項目</h3>
                    {draft.definition.fields.length === 0 && (
                      <p className="py-6 text-center text-xs text-slate-400">見本の上で数字の欄を囲むと項目が増えます</p>
                    )}
                    <ul className="space-y-2">
                      {draft.definition.fields.map((field) => {
                        const unit = unitOptions.find((option) => option.value === field.unitId)?.unit;
                        return (
                          <li
                            key={field.id}
                            className={`space-y-2 rounded-lg border p-2 ${field.id === selectedFieldId ? "border-sky-400 bg-sky-50/40" : "border-slate-200"}`}
                            onPointerDown={() => setSelectedFieldId(field.id)}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                value={field.label}
                                onChange={(event) => patchField(field.id, { label: event.target.value })}
                                className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm"
                                aria-label="項目の名前"
                                disabled={!canWrite}
                              />
                              <CustomSelect
                                value={field.value.type}
                                onChange={(value) =>
                                  patchField(field.id, {
                                    value: { ...field.value, type: value as TemplateField["value"]["type"] },
                                    role: value === "date" ? "date" : "entry",
                                  })
                                }
                                options={VALUE_TYPES}
                                className="h-9 w-32"
                              />
                              {canWrite && (
                                <button
                                  type="button"
                                  aria-label={`${field.label}を消す`}
                                  onClick={() => removeField(field.id)}
                                  className="flex h-9 w-9 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                                >
                                  <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            {(field.role ?? "entry") !== "date" && (
                              <div className="flex flex-wrap items-center gap-2">
                                <CheckboxField
                                  checked={(field.role ?? "entry") === "check"}
                                  onCheckedChange={(checked) =>
                                    patchField(field.id, {
                                      role: checked ? "check" : "entry",
                                      ...(checked ? { unitId: "", fieldKey: "", required: false } : {}),
                                    })
                                  }
                                  label="検算用（日報には入れない）"
                                  disabled={!canWrite}
                                />
                              </div>
                            )}
                            {((field.locator.kind === "region" && (field.locator.column || field.locator.row)) ||
                              field.locator.kind === "anchor") && (
                              <div className="flex flex-wrap items-center gap-1">
                                {(field.locator.kind === "anchor" ? (["row"] as const) : (["row", "column"] as const)).map((side) => {
                                  const locator = field.locator as Extract<TemplateField["locator"], { kind: "region" }>;
                                  const anchorLocator = field.locator as Extract<TemplateField["locator"], { kind: "anchor" }>;
                                  const isAnchorKind = field.locator.kind === "anchor";
                                  const anchor = isAnchorKind ? anchorLocator.anchor : locator[side];
                                  if (!anchor) return null;
                                  return (
                                    <span
                                      key={side}
                                      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600"
                                    >
                                      {side === "row" ? "行" : "列"}:
                                      {/* 見本の読み取りが崩れた見出しは、ここで正しい文字に直せる */}
                                      <input
                                        value={anchor.text}
                                        onChange={(event) =>
                                          patchField(field.id, {
                                            locator: isAnchorKind
                                              ? { ...anchorLocator, anchor: { ...anchor, text: event.target.value } }
                                              : { ...locator, [side]: { ...anchor, text: event.target.value } },
                                          })
                                        }
                                        disabled={!canWrite}
                                        aria-label={`${side === "row" ? "行" : "列"}の見出し`}
                                        className="w-24 rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]"
                                      />
                                      {canWrite && (
                                        <button
                                          type="button"
                                          aria-label={`${anchor.text}を手がかりにしない`}
                                          onClick={() =>
                                            patchField(field.id, {
                                              locator: isAnchorKind
                                                ? { ...anchorLocator, valueHint: null }
                                                : { ...locator, [side]: null },
                                            })
                                          }
                                          className="text-slate-400 hover:text-slate-700"
                                        >
                                          <FontAwesomeIcon icon={faXmark} className="h-2.5 w-2.5" />
                                        </button>
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            {(field.role ?? "entry") === "entry" && (
                              <div className="flex flex-wrap items-center gap-2">
                                <CustomSelect
                                  value={field.unitId}
                                  onChange={(value) => patchField(field.id, { unitId: value, fieldKey: "" })}
                                  options={[{ value: "", label: "報告単位" }, ...unitOptions.map(({ value, label }) => ({ value, label }))]}
                                  className="h-9 w-56"
                                />
                                <CustomSelect
                                  value={field.fieldKey}
                                  onChange={(value) => patchField(field.id, { fieldKey: value })}
                                  options={[
                                    { value: "", label: "報告項目" },
                                    ...(unit?.fields ?? []).map((f) => ({ value: f.field_key, label: f.label })),
                                  ]}
                                  className="h-9 w-48"
                                />
                                <CheckboxField
                                  checked={field.required}
                                  onCheckedChange={(checked) => patchField(field.id, { required: checked })}
                                  label="必須"
                                  disabled={!canWrite}
                                />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium text-slate-800">検算</h3>
                      {canWrite && (
                        <Button variant="ghost" size="sm" onClick={addCheck}>
                          <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
                          合計を確かめる
                        </Button>
                      )}
                    </div>
                    {(draft.definition.checks ?? []).length === 0 ? (
                      <p className="py-3 text-center text-xs text-slate-400">合計と内訳の照合は設定されていません</p>
                    ) : (
                      <ul className="space-y-2">
                        {(draft.definition.checks ?? []).map((check, index) => {
                          const entries = draft.definition.fields.filter((field) => (field.role ?? "entry") === "entry");
                          return (
                            <li key={`${check.totalFieldId}-${index}`} className="space-y-1.5 rounded-lg border border-slate-200 p-2">
                              <div className="flex items-center gap-2">
                                <CustomSelect
                                  value={check.totalFieldId}
                                  onChange={(value) => patchCheck(index, { totalFieldId: value })}
                                  options={entries.map((field) => ({ value: field.id, label: field.label }))}
                                  className="h-9 w-48"
                                />
                                <span className="text-xs text-slate-500">＝ 内訳の合計</span>
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
                                {entries
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
                  </div>

                  <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium text-slate-800">別のスクショで試す</h3>
                      <Button variant="ghost" size="sm" disabled={busy != null} onClick={() => verifyInput.current?.click()}>
                        画像を選ぶ
                      </Button>
                    </div>
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
                    {verify && (
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
                          <p key={reason} className="text-[11px] text-amber-700">
                            {reason}
                          </p>
                        ))}
                        <ul className="divide-y divide-slate-100 text-xs">
                          {verify.rows.map((row) => (
                            <li key={row.label} className="flex items-center justify-between gap-2 py-1">
                              <span className="truncate text-slate-700">{row.label}</span>
                              <span className="flex items-center gap-1 tabular-nums text-slate-900">
                                {row.value}
                                {row.status === "read" && (
                                  <FontAwesomeIcon icon={faCircleCheck} className="h-3 w-3 text-emerald-600" />
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {verify.warnings.map((warning) => (
                          <p key={warning} className="text-[11px] text-amber-700">
                            {warning}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {canWrite && draft.status === "draft" && (
                <Button
                  variant="ghost"
                  className="text-red-600"
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
                >
                  <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" />
                  この様式を消す
                </Button>
              )}
            </>
          )}
        </section>
      </div>

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
            />
            {!carrierId && (
              <p className="text-xs text-amber-700">キャリア設定の「画像の様式」から追加してください</p>
            )}
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
