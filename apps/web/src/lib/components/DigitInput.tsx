"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeDigitText } from "@/lib/numericInput";

export function DigitInput({ value, onValueChange, allowEmpty = false, readOnly = false, disabled = false, placeholder, className, ariaLabel, id, ariaInvalid, ariaDescribedBy }: {
  value: number | null;
  onValueChange?: (value: number | null) => void;
  allowEmpty?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className: string;
  ariaLabel?: string;
  id?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  // IME変換中は全角数字をそのまま保持し、確定時にだけ半角へ正規化する。
  // ローカル文字列を持つことで、必須項目の全消去時に0が即座に戻る問題も避ける。
  const [text, setText] = useState(value == null ? "" : String(value));
  const composingRef = useRef(false);

  useEffect(() => {
    if (composingRef.current) return;
    const next = value == null ? "" : String(value);
    if (text !== next) setText(next);
    // 入力中のtextではなく、外部値が変わったときだけ同期する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (raw: string) => {
    const digits = normalizeDigitText(raw);
    setText(digits);
    onValueChange?.(digits === "" ? (allowEmpty ? null : 0) : Number(digits));
  };

  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      pattern="[0-9０-９]*"
      value={text}
      readOnly={readOnly}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid || undefined}
      aria-describedby={ariaDescribedBy}
      onCompositionStart={readOnly ? undefined : () => { composingRef.current = true; }}
      onCompositionEnd={readOnly ? undefined : (event) => {
        composingRef.current = false;
        commit(event.currentTarget.value);
      }}
      onChange={readOnly ? undefined : (event) => {
        if (composingRef.current) setText(event.target.value);
        else commit(event.target.value);
      }}
      onBlur={readOnly ? undefined : () => {
        composingRef.current = false;
        const digits = normalizeDigitText(text);
        if (digits === "" && !allowEmpty) {
          setText("0");
          onValueChange?.(0);
        } else {
          setText(digits);
          onValueChange?.(digits === "" ? null : Number(digits));
        }
      }}
      className={className}
    />
  );
}
