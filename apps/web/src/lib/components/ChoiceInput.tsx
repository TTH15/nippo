"use client";

import { useId } from "react";
import { CheckboxField } from "./CheckboxField";
import { RadioField } from "./RadioField";
import { SmoothCollapse } from "./SmoothCollapse";
import { choiceSelection, OTHER_TEXT_MAX_LENGTH, type ChoiceValue } from "@/lib/formBuilder/choiceAnswers";

export function ChoiceInput({ id, label, options, multiple = false, allowOther = false, required = false, value, onChange }: {
  id?: string;
  label: string;
  options: { value: string; label: string }[];
  multiple?: boolean;
  allowOther?: boolean;
  required?: boolean;
  value: ChoiceValue | undefined;
  onChange: (value: ChoiceValue) => void;
}) {
  const generatedId = useId();
  const groupId = id ?? generatedId;
  const { selected, other } = choiceSelection(value);
  const hasOther = allowOther && other !== undefined;
  const otherPanel = `${groupId}-other-panel`;
  const otherInput = `${groupId}-other-text`;
  const toggleOption = (option: string, checked: boolean) => {
    if (!multiple) { onChange(option); return; }
    const next = checked ? [...selected.filter(item => item !== option), option] : selected.filter(item => item !== option);
    onChange(hasOther ? { selected: next, other: other! } : next);
  };
  const toggleOther = (checked: boolean) => onChange(checked ? { selected: multiple ? selected : [], other: other ?? "" } : multiple ? selected : "");

  return <div>
    <div id={groupId} role={multiple ? "group" : "radiogroup"} aria-label={label} aria-required={multiple ? undefined : required} className="grid gap-2">
      {options.map(option => multiple
        ? <CheckboxField key={option.value} variant="row" label={option.label} checked={selected.includes(option.value)} onCheckedChange={checked => toggleOption(option.value, checked)}/>
        : <RadioField key={option.value} name={`${groupId}-choice`} label={option.label} checked={!hasOther && selected.includes(option.value)} onSelect={() => toggleOption(option.value, true)}/>) }
      {allowOther && <div className="space-y-1">
        {multiple
          ? <CheckboxField variant="row" label="その他（自由入力）" checked={hasOther} aria-controls={otherPanel} aria-expanded={hasOther} onCheckedChange={toggleOther}/>
          : <RadioField name={`${groupId}-choice`} label="その他（自由入力）" checked={hasOther} aria-controls={otherPanel} aria-expanded={hasOther} onSelect={() => toggleOther(true)}/>}
        <SmoothCollapse open={hasOther} id={otherPanel}>
          <div className="pb-1 pl-8 pt-1">
            <label className="sr-only" htmlFor={otherInput}>{label}のその他の内容</label>
            <input id={otherInput} type="text" value={other ?? ""} maxLength={OTHER_TEXT_MAX_LENGTH} required={hasOther}
              placeholder="内容を入力してください" onChange={event => onChange({ selected: multiple ? selected : [], other: event.target.value })}
              className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"/>
          </div>
        </SmoothCollapse>
      </div>}
    </div>
    {!required && !multiple && (selected.length > 0 || hasOther) && <button type="button" onClick={() => onChange("")} className="mt-1 min-h-9 rounded px-2 text-xs text-slate-500 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-amber-400">選択をクリア</button>}
  </div>;
}
