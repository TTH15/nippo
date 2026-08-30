"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronUp,
  faCopy,
  faTrash,
  faSliders,
  faPlus,
  faCircle,
  faSquare,
  faWandMagicSparkles,
  faRotateLeft,
} from "@fortawesome/free-solid-svg-icons";
import { FieldTypeSelect } from "@/lib/components/FieldTypeSelect";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { Button } from "@/lib/ui/button";
import {
  FIELD_TYPE_LABELS,
  type FormFieldType,
} from "@/lib/formBuilder/fieldTypes";
import { control, FieldControl } from "./Fields";
import { inferAutomaticField } from "./fieldEditing";
import type { AnswerMap, RecordField } from "./model";

type Props = {
  field: RecordField;
  index: number;
  handle: ReactNode;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onChange: (patch: Partial<RecordField>) => void;
  onTypeChange: (type: FormFieldType, mode: "auto" | "manual") => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDuplicate: boolean;
  answer: AnswerMap[string] | undefined;
  onAnswer: (answer: AnswerMap[string]) => void;
};

export function FieldEditorCard({
  field,
  index,
  handle,
  active,
  onSelect,
  onClose,
  onChange,
  onTypeChange,
  onDuplicate,
  onDelete,
  canDuplicate,
  answer,
  onAnswer,
}: Props) {
  const [details, setDetails] = useState(false);
  const [composing, setComposing] = useState(false);
  const [autoChange, setAutoChange] = useState<{
    from: FormFieldType;
    to: FormFieldType;
  } | null>(null);
  const automatic = field.typeSelection === "auto";
  const choice = field.type === "select" || field.type === "multiselect";
  const settingsId = `field-settings-${field.id}`;
  const hasInputSettings = ["short_text", "long_text", "number"].includes(
    field.type,
  );

  useEffect(() => {
    if (!automatic || composing) return;
    const timer = setTimeout(() => {
      const next = inferAutomaticField(field);
      if (next.type !== field.type) {
        setAutoChange({ from: field.type, to: next.type });
        onTypeChange(next.type, "auto");
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [field, automatic, composing, onTypeChange]);

  const manuallyChangeType = (type: FormFieldType) => {
    setAutoChange(null);
    onTypeChange(type, "manual");
  };
  return (
    <div
      className="relative"
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelect();
      }}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute bottom-4 left-0 top-4 w-1 rounded-r bg-amber-400"
        />
      )}
      <div className="flex items-start gap-1 px-2 pt-4 sm:px-3 sm:pt-5">
        <div className="pt-0.5">{handle}</div>
        <div
          className="grid min-w-0 flex-1 gap-3 pr-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:pr-3"
          onFocusCapture={onSelect}
        >
          <div className="flex min-w-0 items-start gap-1">
            <input
              autoFocus={active && automatic && !field.label}
              aria-label={`項目名 ${index + 1}`}
              value={field.label}
              maxLength={80}
              placeholder="項目名"
              onChange={(event) => onChange({ label: event.target.value })}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              className={`min-h-12 w-full min-w-0 rounded-t-md border-0 border-b-2 px-2 py-2.5 text-base font-semibold text-slate-900 outline-none transition-colors focus:border-amber-400 focus:bg-slate-50 sm:text-lg ${active ? "border-slate-200 bg-slate-50/70" : "border-transparent bg-transparent hover:border-slate-200"}`}
            />
            {field.required && (
              <span aria-label="必須" className="pt-3 text-amber-700">
                *
              </span>
            )}
          </div>
          <FieldTypeSelect
            label={`入力形式 ${index + 1}`}
            value={field.type}
            onChange={manuallyChangeType}
          />
        </div>
      </div>

      <div
        className="px-5 pb-5 pt-5 sm:px-7"
        onFocusCapture={choice ? undefined : onSelect}
        onClick={choice ? undefined : onSelect}
      >
        {choice && active ? (
          <div className="space-y-2" role="group" aria-label="選択肢の編集">
            {field.options?.map((option, optionIndex) => (
              <div key={option.value} className="flex items-center gap-3">
                <FontAwesomeIcon
                  icon={field.type === "select" ? faCircle : faSquare}
                  className="size-4 text-slate-200"
                />
                <input
                  aria-label={`選択肢 ${optionIndex + 1}`}
                  value={option.label}
                  maxLength={80}
                  onChange={(event) =>
                    onChange({
                      options: field.options!.map((o) =>
                        o.value === option.value
                          ? { ...o, label: event.target.value }
                          : o,
                      ),
                      typeSelection: "manual",
                    })
                  }
                  className="min-h-11 min-w-0 flex-1 border-b border-slate-200 bg-transparent px-1 text-sm outline-none transition-colors hover:border-slate-400 focus:border-amber-400"
                />
                <Button
                  type="button"
                  size="icon-touch"
                  variant="ghost"
                  aria-label={`選択肢 ${optionIndex + 1}を削除`}
                  onClick={() =>
                    onChange({
                      options: field.options!.filter(
                        (o) => o.value !== option.value,
                      ),
                      typeSelection: "manual",
                    })
                  }
                >
                  <FontAwesomeIcon
                    icon={faTrash}
                    className="size-3.5 text-slate-400"
                  />
                </Button>
              </div>
            ))}
            {field.allowOther && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <FontAwesomeIcon
                  icon={field.type === "select" ? faCircle : faSquare}
                  className="size-4 text-slate-300"
                />
                <span className="text-sm text-slate-700">その他</span>
                <span className="min-w-24 flex-1 border-b border-dashed border-slate-300 py-2 text-xs text-slate-400">
                  回答者が自由に入力
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-touch"
                  aria-label="その他の自由入力を削除"
                  onClick={() =>
                    onChange({ allowOther: false, typeSelection: "manual" })
                  }
                >
                  <FontAwesomeIcon
                    icon={faTrash}
                    className="size-3.5 text-slate-400"
                  />
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="touch"
                onClick={() =>
                  onChange({
                    options: [
                      ...(field.options ?? []),
                      { value: crypto.randomUUID(), label: "新しい選択肢" },
                    ],
                    typeSelection: "manual",
                  })
                }
              >
                <FontAwesomeIcon icon={faPlus} />
                選択肢を追加
              </Button>
              {!field.allowOther && (
                <Button
                  type="button"
                  variant="ghost"
                  size="touch"
                  className="text-amber-800"
                  onClick={() =>
                    onChange({ allowOther: true, typeSelection: "manual" })
                  }
                >
                  「その他」を追加
                </Button>
              )}
            </div>
          </div>
        ) : (
          <FieldControl
            field={{
              ...field,
              placeholder:
                field.placeholder ||
                (field.type === "short_text"
                  ? "短い回答を入力"
                  : field.type === "long_text"
                    ? "回答を入力"
                    : field.type === "number"
                      ? "数値を入力"
                      : undefined),
            }}
            hideLabel
            value={answer}
            onChange={onAnswer}
          />
        )}
        {choice && !active && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 text-xs text-slate-500"
            onClick={onSelect}
          >
            選択肢を編集
          </Button>
        )}
      </div>

      <SmoothCollapse open={active} id={settingsId}>
        <div className="px-5 pb-4 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-center gap-1">
              <CheckboxField
                label="必須"
                checked={field.required}
                onCheckedChange={(required) => onChange({ required })}
              />
            </div>
            <div className="flex items-center gap-1">
              {hasInputSettings && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-touch"
                  aria-label={`入力の設定 ${index + 1}`}
                  title="入力の設定"
                  aria-expanded={details}
                  aria-controls={`field-options-${field.id}`}
                  onClick={() => setDetails(!details)}
                >
                  <FontAwesomeIcon icon={faSliders} />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-touch"
                aria-label={`${field.label || "項目"}を複製`}
                title="項目を複製"
                disabled={!canDuplicate}
                onClick={onDuplicate}
              >
                <FontAwesomeIcon icon={faCopy} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-touch"
                aria-label={`${field.label || "項目"}を削除`}
                title="項目を削除"
                className="text-slate-400 hover:bg-red-50 hover:text-red-600"
                onClick={onDelete}
              >
                <FontAwesomeIcon icon={faTrash} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-touch"
                aria-label={`編集を閉じる ${index + 1}`}
                title="編集を閉じる"
                aria-expanded={active}
                aria-controls={settingsId}
                onClick={onClose}
              >
                <FontAwesomeIcon
                  icon={faChevronUp}
                  className="text-slate-400"
                />
              </Button>
            </div>
          </div>

          <SmoothCollapse
            open={details && hasInputSettings}
            id={`field-options-${field.id}`}
          >
            <div className="space-y-3 rounded-lg bg-slate-50 p-4">
              <label className="block text-xs font-medium text-slate-600">
                入力例・プレースホルダー
                <input
                  className={`${control} mt-1.5`}
                  value={field.placeholder ?? ""}
                  onChange={(event) =>
                    onChange({ placeholder: event.target.value })
                  }
                />
              </label>
              {field.type === "number" && (
                <div className="grid grid-cols-3 gap-3">
                  {(["min", "max", "unit"] as const).map((key, i) => (
                    <label
                      key={key}
                      className="text-xs font-medium text-slate-600"
                    >
                      {["最小値", "最大値", "単位"][i]}
                      <input
                        type={key === "unit" ? "text" : "number"}
                        className={`${control} mt-1.5`}
                        value={field[key] ?? ""}
                        onChange={(event) =>
                          onChange({
                            [key]:
                              key === "unit"
                                ? event.target.value
                                : event.target.value === ""
                                  ? undefined
                                  : Number(event.target.value),
                            typeSelection: "manual",
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          </SmoothCollapse>

          <div className="mt-1 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              aria-pressed={automatic}
              title="有効にすると項目名から入力形式を選びます"
              onClick={() => {
                setAutoChange(null);
                onChange({ typeSelection: automatic ? "manual" : "auto" });
              }}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded px-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${automatic ? "text-amber-800" : "text-slate-400 hover:text-slate-600"}`}
            >
              <FontAwesomeIcon icon={faWandMagicSparkles} className="size-3" />
              形式の自動選択{automatic ? " ON" : " OFF"}
            </button>
            {autoChange && automatic && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span role="status">
                  項目名から「{FIELD_TYPE_LABELS[autoChange.to]}」を選択
                </span>
                <button
                  type="button"
                  className="inline-flex min-h-9 items-center gap-1 rounded px-1 text-slate-700 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-amber-400"
                  onClick={() => manuallyChangeType(autoChange.from)}
                >
                  <FontAwesomeIcon icon={faRotateLeft} className="size-3" />
                  元に戻す
                </button>
              </div>
            )}
          </div>
        </div>
      </SmoothCollapse>
    </div>
  );
}
