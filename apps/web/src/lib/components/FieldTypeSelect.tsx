"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAlignLeft, faBars, faHashtag, faCircleDot, faListCheck, faCalendarDay, faClock, faToggleOn, faUser } from "@fortawesome/free-solid-svg-icons";
import { CustomSelect } from "./CustomSelect";
import { FIELD_TYPE_LABELS, FIELD_TYPE_DESCRIPTIONS, type FormFieldType } from "@/lib/formBuilder/fieldTypes";

export const FIELD_TYPE_ICONS = {
  short_text: faBars, long_text: faAlignLeft, number: faHashtag,
  select: faCircleDot, multiselect: faListCheck, date: faCalendarDay,
  time: faClock, bool: faToggleOn, member: faUser,
};

/** フォーム編集用の形式選択。既存Selectの操作・配置を再利用する。 */
export function FieldTypeSelect({ value, onChange, label }: { value: FormFieldType; onChange: (value: FormFieldType) => void; label: string }) {
  return <CustomSelect value={value} onChange={value => onChange(value as FormFieldType)} ariaLabel={label}
    options={(Object.keys(FIELD_TYPE_LABELS) as FormFieldType[]).map(type => ({
      value: type, label: FIELD_TYPE_LABELS[type], description: FIELD_TYPE_DESCRIPTIONS[type],
      icon: <FontAwesomeIcon icon={FIELD_TYPE_ICONS[type]} className="size-4"/>,
    }))}
    clearable={false} size="md" showSelectedDescription={false} showOptionDescriptions
    triggerClassName="!h-12 !rounded-lg !border !border-slate-200 focus:!border-amber-400 focus:!ring-2 focus:!ring-amber-100"
  />;
}
