"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeDecimalText, normalizeDigitText } from "@/lib/numericInput";

export function DigitInput({ value, onValueChange, allowEmpty = false, decimals = 0, readOnly = false, disabled = false, placeholder, className, ariaLabel, id, ariaInvalid, ariaDescribedBy }: {
  value: number | null;
  onValueChange?: (value: number | null) => void;
  allowEmpty?: boolean;
  /** 小数を許す桁数。0（既定）は整数のみ。契約単価など小数入力では 2 を渡す。 */
  decimals?: number;
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
  const normalize = (raw: string) => (decimals > 0 ? normalizeDecimalText(raw, decimals) : normalizeDigitText(raw));
  // 入力途中の "157." / "." は数値にできないので、確定値としては小数点を落として読む。
  const parse = (digits: string): number | null => {
    if (digits === "" || digits === ".") return null;
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : null;
  };

  useEffect(() => {
    if (composingRef.current) return;
    const next = value == null ? "" : String(value);
    // "157." の入力途中に親から 157 が返ってきても、末尾の小数点を消さない
    if (parse(text) === value && text !== "") return;
    if (text !== next) setText(next);
    // 入力中のtextではなく、外部値が変わったときだけ同期する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (raw: string) => {
    const digits = normalize(raw);
    setText(digits);
    const parsed = parse(digits);
    onValueChange?.(parsed == null ? (allowEmpty ? null : 0) : parsed);
  };

  return (
    <input
      id={id}
      type="text"
      inputMode={decimals > 0 ? "decimal" : "numeric"}
      pattern={decimals > 0 ? "[0-9０-９.．]*" : "[0-9０-９]*"}
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
        const digits = normalize(text);
        const parsed = parse(digits);
        if (parsed == null && !allowEmpty) {
          setText("0");
          onValueChange?.(0);
        } else {
          // 確定時は "157." → "157" のように正規化した数値表現へ揃える
          setText(parsed == null ? "" : String(parsed));
          onValueChange?.(parsed);
        }
      }}
      className={className}
    />
  );
}
