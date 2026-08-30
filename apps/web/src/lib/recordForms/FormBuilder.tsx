"use client";
import { SortableList } from "@/lib/components/SortableList";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { useEffect, useState, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faChevronLeft } from "@fortawesome/free-solid-svg-icons";
import { Button } from "@/lib/ui/button";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { Choice, control } from "./Fields";
import { FieldEditorCard } from "./FieldEditorCard";
import { ListDisplaySettings } from "./ListDisplaySettings";
import { applyFieldType } from "./fieldEditing";
import type { FormFieldType } from "@/lib/formBuilder/fieldTypes";
import {
  RESPONSE_STATUSES,
  responseStatuses,
  validateDefinition,
  type AnswerMap,
  type RecordField,
  type RecordEntry,
  type RecordForm,
} from "./model";

import { useFormUI } from "./context";

type Props = {
  form: RecordForm;
  onApply: (form: RecordForm) => void | Promise<void>;
  onClose: () => void;
  existingCount: number;
  sampleRecord?: RecordEntry;
  isNew?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
};
export default function FormBuilder({
  form,
  onApply,
  onClose,
  existingCount,
  sampleRecord,
  isNew = false,
  onDirtyChange,
}: Props) {
  const { roles, preview } = useFormUI();
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => structuredClone(form));
  const [section, setSection] = useState("fields");
  const [selected, setSelected] = useState(form.fields[0]?.id ?? "");
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [error, setError] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(form);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const setField = (id: string, patch: Partial<RecordField>) =>
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  const add = (afterSelected = true) => {
    const id = crypto.randomUUID();
    setDraft((d) => {
      const fields = [...d.fields];
      const after = afterSelected
        ? fields.findIndex((f) => f.id === selected)
        : -1;
      fields.splice(after < 0 ? fields.length : after + 1, 0, {
        id,
        type: "short_text",
        label: "",
        required: false,
        typeSelection: "auto",
      });
      return { ...d, fields };
    });
    setSelected(id);
  };
  const changeType = (
    id: string,
    type: FormFieldType,
    mode: "auto" | "manual",
  ) => {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f) =>
        f.id === id && (mode !== "auto" || f.typeSelection === "auto")
          ? applyFieldType(f, type, mode)
          : f,
      ),
    }));
    setAnswers((a) => {
      const next = { ...a };
      delete next[id];
      return next;
    });
  };
  const duplicate = (field: RecordField) => {
    const copy = {
      ...structuredClone(field),
      id: crypto.randomUUID(),
      label: `${field.label}のコピー`,
      typeSelection: "manual" as const,
    };
    setDraft((d) => {
      const fields = [...d.fields];
      fields.splice(fields.findIndex((f) => f.id === field.id) + 1, 0, copy);
      return { ...d, fields };
    });
    setSelected(copy.id);
  };
  const remove = (id: string) => {
    setDraft((d) => ({
      ...d,
      fields: d.fields.filter((f) => f.id !== id),
      titleField: d.titleField === id ? "" : d.titleField,
      dateField: d.dateField === id ? "" : d.dateField,
      subjectField: d.subjectField === id ? "" : d.subjectField,
    }));
    setSelected("");
  };
  const apply = () => {
    const message = validateDefinition(draft);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    setConfirmApply(true);
  };
  const tabs = [
    { id: "fields", label: "項目" },
    { id: "display", label: "一覧・状態" },
    { id: "access", label: "公開・権限" },
  ];
  return (
    <fieldset disabled={saving} className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => !saving && (dirty ? setConfirmLeave(true) : onClose())}
        >
          <FontAwesomeIcon icon={faChevronLeft} />
          フォーム一覧に戻る
        </Button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {isNew ? "未作成" : `編集中 · v${form.version + 1}`}
          </span>
          <Button size="touch" onClick={apply} disabled={saving}>
            {isNew ? "フォームを作成" : "設定を適用"}
          </Button>
        </div>
      </div>
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[2fr_1fr]">
        <label className="text-xs font-semibold text-slate-600">
          フォーム名
          <input
            className={`${control} mt-1.5`}
            value={draft.name}
            maxLength={80}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          カテゴリ
          <input
            className={`${control} mt-1.5`}
            value={draft.category}
            maxLength={40}
            onChange={(e) =>
              setDraft((d) => ({ ...d, category: e.target.value }))
            }
            placeholder="例：配送品質"
          />
        </label>
      </div>
      <div
        className="flex gap-1 border-b border-slate-200"
        role="tablist"
        aria-label="フォーム設定"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={section === t.id}
            onClick={() => setSection(t.id)}
            className={`border-b-2 px-5 py-3 text-sm font-semibold ${section === t.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-900"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      {section === "fields" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="text-slate-600">{draft.fields.length}項目</span>
              <span>入力欄は試し入力用・回答は保存されません</span>
            </div>
            <Button
              variant="outline"
              size="touch"
              onClick={() => add()}
              disabled={draft.fields.length >= 40}
            >
              <FontAwesomeIcon icon={faPlus} />
              項目を追加
            </Button>
          </div>
          <SortableList
            items={draft.fields}
            onReorder={(fields) => setDraft((d) => ({ ...d, fields }))}
            getLabel={(f) => f.label || "名称未設定"}
            label="フォームの項目"
            itemClassName={(f) =>
              selected === f.id
                ? "border-slate-300 shadow-sm"
                : "hover:border-slate-300"
            }
          >
            {(f, handle) => (
              <FieldEditorCard
                field={f}
                index={draft.fields.findIndex((item) => item.id === f.id)}
                handle={handle}
                active={selected === f.id}
                onSelect={() => setSelected(f.id)}
                onClose={() => setSelected("")}
                onChange={(patch) => setField(f.id, patch)}
                onTypeChange={(type, mode) => changeType(f.id, type, mode)}
                onDuplicate={() => duplicate(f)}
                onDelete={() => remove(f.id)}
                canDuplicate={draft.fields.length < 40}
                answer={answers[f.id]}
                onAnswer={(answer) =>
                  setAnswers((a) => ({ ...a, [f.id]: answer }))
                }
              />
            )}
          </SortableList>
          <Button
            variant="outline"
            size="touch"
            className="w-full border-dashed bg-transparent text-slate-600"
            onClick={() => add(false)}
            disabled={draft.fields.length >= 40}
          >
            <FontAwesomeIcon icon={faPlus} />
            末尾に項目を追加
          </Button>
        </section>
      )}
      {section === "display" && (
        <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {(["titleField", "dateField", "subjectField"] as const).map(
              (key, i) => (
                <div key={key} className="space-y-2">
                  <p className="text-xs font-semibold text-slate-600">
                    {
                      [
                        "件名に使う項目",
                        "日付で絞り込む項目",
                        "対象者に使う項目",
                      ][i]
                    }
                  </p>
                  <Choice
                    label={
                      [
                        "件名に使う項目",
                        "日付で絞り込む項目",
                        "対象者に使う項目",
                      ][i]
                    }
                    value={draft[key]}
                    options={[
                      {
                        value: "",
                        label:
                          key === "titleField"
                            ? "選択してください"
                            : "使わない",
                      },
                      ...draft.fields
                        .filter((f) =>
                          key === "dateField"
                            ? f.type === "date"
                            : key === "subjectField"
                              ? f.type === "member"
                              : true,
                        )
                        .map((f) => ({ value: f.id, label: f.label })),
                    ]}
                    onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
                  />
                </div>
              ),
            )}
          </div>
          <ListDisplaySettings
            form={draft}
            sample={sampleRecord}
            onFieldChange={setField}
          />
          <section
            className="border-t border-slate-200 pt-5"
            aria-label="対応状況の設定"
          >
            <CheckboxField
              label="対応状況を使う"
              checked={draft.statuses.length > 0}
              aria-controls="response-status-guide"
              aria-expanded={draft.statuses.length > 0}
              onCheckedChange={(enabled) =>
                setDraft((d) => ({
                  ...d,
                  statuses: enabled ? responseStatuses() : [],
                }))
              }
            />
            <SmoothCollapse
              open={draft.statuses.length > 0}
              id="response-status-guide"
            >
              <div className="px-3 pt-3">
                <ul
                  className="flex flex-wrap items-center gap-2 text-sm"
                  aria-label="共通の対応状況"
                >
                  {RESPONSE_STATUSES.map((status) => (
                    <li
                      key={status.id}
                      className={`rounded-lg px-3 py-2 ${status.terminal ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-900"}`}
                    >
                      <span className="font-medium">{status.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </SmoothCollapse>
          </section>
        </section>
      )}
      {section === "access" && (
        <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h3 className="mb-3 font-semibold">運営側の権限</h3>
            <div className="divide-y divide-slate-100">
              {roles.map((role) => (
                <div
                  key={role.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <span className="text-sm">{role.label}</span>
                  <div className="w-44">
                    <Choice
                      label={`${role.label}の権限`}
                      value={
                        role.manager
                          ? "edit"
                          : (draft.access[role.id] ?? "none")
                      }
                      disabled={role.manager}
                      options={[
                        { value: "none", label: "アクセス不可" },
                        { value: "view", label: "閲覧のみ" },
                        { value: "edit", label: "入力・編集可能" },
                      ]}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          access: {
                            ...d.access,
                            [role.id]: v as "none" | "view" | "edit",
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-slate-200 pt-5">
            <h3 className="mb-4 font-semibold">ドライバーへの公開</h3>
            <div className="grid gap-2">
              {(
                [
                  { key: "submit", label: "このフォームから報告できる" },
                  { key: "readOwn", label: "自分が入力した記録を読める" },
                  { key: "editOwn", label: "自分が入力した記録を修正できる" },
                  { key: "readSubject", label: "自分が対象者の記録を読める" },
                ] as const
              ).map((item) => (
                <CheckboxField
                  key={item.key}
                  variant="row"
                  label={item.label}
                  checked={draft.driver[item.key]}
                  onCheckedChange={(checked) =>
                    setDraft((d) => ({
                      ...d,
                      driver: {
                        ...d.driver,
                        [item.key]: checked,
                        ...(item.key === "readOwn" && !checked
                          ? { editOwn: false }
                          : {}),
                      },
                    }))
                  }
                />
              ))}
            </div>
            <p className="mt-5 rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600">
              他人の記録と運営専用メモは公開しません。「報告できる」と「記録を読める」は別々に設定します。
            </p>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-4 text-sm">
            <span>業務連携</span>
            <span className="text-slate-500">
              なし（売上・報酬・車両情報は変更しません）
            </span>
          </div>
        </section>
      )}
      <ConfirmDialog
        open={confirmApply}
        title={isNew ? "フォームを作成" : "フォーム設定を適用"}
        message={
          preview
            ? "プレビュー内に反映します。実際のDBには保存しません。"
            : isNew
              ? "この組織にフォームを作成します。"
              : "設定を更新します。既存記録は登録時の項目を保持します。公開・権限の変更は既存記録にも反映されます。"
        }
        confirmLabel={isNew ? "作成する" : "適用する"}
        tone="neutral"
        onClose={() => setConfirmApply(false)}
        onConfirm={async () => {
          if (busy.current) return;
          busy.current = true;
          setSaving(true);
          try {
            await onApply({ ...draft, version: isNew ? 1 : form.version + 1 });
          } catch (e) {
            setError(e instanceof Error ? e.message : "保存に失敗しました");
          } finally {
            busy.current = false;
            setSaving(false);
          }
        }}
      />
      <ConfirmDialog
        open={confirmLeave}
        title="変更を破棄しますか？"
        message="適用していないフォーム設定は失われます。"
        confirmLabel="破棄して戻る"
        onClose={() => setConfirmLeave(false)}
        onConfirm={onClose}
      />
    </fieldset>
  );
}
