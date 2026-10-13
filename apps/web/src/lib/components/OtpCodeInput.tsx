"use client";

import { useId, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";

/** 6マスは表示専用。貼り付け・SMS補完・編集は単一の標準inputで扱う。 */
export function OtpCodeInput({ value, onChange, disabled = false, confirmed = false, invalid = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; confirmed?: boolean; invalid?: boolean;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState(0);
  return <div>
    <label htmlFor={id} className="mb-3 block text-sm text-slate-600">認証コード</label>
    <div className="relative">
      <div aria-hidden="true" className="grid grid-cols-6 gap-1.5">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className={`flex h-14 min-w-0 items-center justify-center rounded-lg border text-2xl leading-8 ${confirmed ? "border-green-600 bg-green-50 text-green-700" : invalid ? "border-red-500 bg-red-50 text-slate-900" : focused && Math.min(position, 5) === index ? "border-slate-900 bg-white text-slate-900 ring-1 ring-slate-900" : "border-slate-200 bg-slate-50 text-slate-900"}`}>
          {confirmed ? <FontAwesomeIcon icon={faCheck} className="w-5" /> : <span className="relative">{value[index] || ""}{focused && !disabled && Math.min(position, 5) === index && <span className="absolute -right-1 top-1/2 h-7 -translate-y-1/2 border-l-2 border-slate-900" />}</span>}
        </div>)}
      </div>
      <input id={id} aria-label="認証コード" aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value} disabled={disabled || confirmed} autoFocus
        className="absolute inset-0 h-14 w-full cursor-text border-0 bg-transparent text-2xl text-transparent caret-transparent outline-none focus:ring-0"
        onFocus={event => { setFocused(true); setPosition(event.target.selectionStart ?? value.length); }} onBlur={() => setFocused(false)}
        onSelect={event => setPosition(event.currentTarget.selectionStart ?? 0)}
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          const next = Math.min(value.length, Math.max(0, Math.floor((event.clientX - rect.left) / (rect.width / 6))));
          event.currentTarget.setSelectionRange(next, next); setPosition(next);
        }}
        onChange={event => { const next = event.target.value.replace(/\D/g, "").slice(0, 6); onChange(next); setPosition(Math.min(event.target.selectionStart ?? next.length, next.length)); }} />
    </div>
    <p id={`${id}-hint`} role={confirmed ? "status" : undefined} className="mt-2 text-xs text-slate-500">{confirmed ? "電話番号を確認しました" : "SMSに届いた6桁の数字"}</p>
  </div>;
}
