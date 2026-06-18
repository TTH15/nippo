"use client";

import { useRef, useState } from "react";
import { CustomSelect } from "@/lib/components/CustomSelect";
import { getToken } from "@/lib/api";
import type { ReportField, AnswerAttachment } from "@/server/reportKinds/fields";

// 諸報告フォームの動的フィールド入力。型ごとに適切な入力UIを描画する。
// value/onChange は型に応じて string | number | string[] | boolean。
// file 型はアップロードを伴うため別途 onFiles / 添付表示を渡す（P4）。

export type DynamicFieldValue = string | number | string[] | boolean | undefined;

const inputCls =
  "w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:border-slate-400 focus:outline-none";

export function DynamicField({
  field,
  value,
  onChange,
  fileSlot,
}: {
  field: ReportField;
  value: DynamicFieldValue;
  onChange: (v: DynamicFieldValue) => void;
  /** file 型の入力UI（P4で渡す）。未指定時は準備中表示。 */
  fileSlot?: React.ReactNode;
}) {
  const label = (
    <label className="block text-sm font-medium text-slate-700 mb-1">
      {field.label}
      {field.required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );

  if (field.type === "bool") {
    const on = value === true;
    return (
      <div>
        {label}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => onChange(!on)}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${on ? "bg-emerald-600" : "bg-slate-300"}`}
        >
          <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${on ? "translate-x-5" : "translate-x-1"}`} />
        </button>
        <span className="ml-2 text-sm text-slate-600">{on ? "はい" : "いいえ"}</span>
      </div>
    );
  }

  return (
    <div>
      {label}
      {field.type === "short_text" && (
        <input type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} maxLength={field.maxLen} className={inputCls} />
      )}
      {field.type === "long_text" && (
        <textarea value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} maxLength={field.maxLen} rows={4} className={`${inputCls} resize-y min-h-[96px]`} />
      )}
      {field.type === "number" && (
        <input
          type="number"
          inputMode="numeric"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          className={inputCls}
        />
      )}
      {field.type === "date" && (
        <input type="date" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      )}
      {field.type === "time" && (
        <input type="time" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      )}
      {field.type === "select" && (
        <CustomSelect
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v)}
          clearable={!field.required}
          placeholder="選択してください"
          options={field.options ?? []}
        />
      )}
      {field.type === "multiselect" && (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((o) => {
            const arr = Array.isArray(value) ? value : [];
            const on = arr.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border ${on ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200"}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
      {field.type === "file" && (fileSlot ?? <p className="text-xs text-slate-400">ファイル添付は準備中です。</p>)}
    </div>
  );
}

/** 諸報告のファイル添付入力（アップロード→参照を保持）。 */
export function ReportFileInput({
  fieldId,
  files,
  onAdd,
  onRemove,
}: {
  fieldId: string;
  files: AnswerAttachment[];
  onAdd: (a: AnswerAttachment) => void;
  onRemove: (path: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = async (file: File) => {
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = getToken();
      const res = await fetch("/api/reports/attachments", {
        method: "POST",
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "アップロードに失敗しました");
      onAdd({ fieldId, path: json.path, name: json.name, mime: json.mime, size: json.size });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-1.5">
      {files.map((f) => (
        <div key={f.path} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <span className="truncate text-slate-700">{f.name}</span>
          <button type="button" onClick={() => onRemove(f.path)} className="shrink-0 text-slate-400 hover:text-red-600" aria-label="削除">
            ×
          </button>
        </div>
      ))}
      <label className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 cursor-pointer hover:border-slate-400">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handle(file);
          }}
        />
        {uploading ? "アップロード中…" : "ファイルを選択（PDF / JPEG / PNG・5MBまで）"}
      </label>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
