"use client";

import { useId, type InputHTMLAttributes } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { cn } from "@/lib/ui/utils";

type CheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "size" | "className"> & {
  label: string;
  description?: string;
  onCheckedChange: (checked: boolean) => void;
  variant?: "compact" | "row";
  className?: string;
};

/** ネイティブのキーボード操作を保ち、ラベル全体を押せる共通チェック項目。 */
export function CheckboxField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
  variant = "compact",
  className,
  id,
  ...props
}: CheckboxFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;

  return (
    <label
      htmlFor={inputId}
      className={cn("group relative block select-none", disabled ? "cursor-not-allowed" : "cursor-pointer", className)}
    >
      <input
        {...props}
        id={inputId}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        aria-describedby={descriptionId ?? props["aria-describedby"]}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm",
          "transition-[background-color,border-color,box-shadow] duration-150 motion-reduce:transition-none",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-amber-400 peer-focus-visible:ring-offset-2",
          "peer-disabled:opacity-50",
          variant === "row" ? "w-full border-slate-200 bg-white" : "border-transparent",
          checked ? "border-amber-200 bg-amber-50/70 text-slate-900" : "text-slate-600",
          !disabled && (checked ? "group-hover:bg-amber-50" : "group-hover:border-slate-300 group-hover:bg-slate-50"),
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-[6px] border shadow-sm",
            "transition-[transform,background-color,border-color] duration-150 ease-out motion-reduce:transition-none",
            !disabled && "group-active:scale-90 motion-reduce:group-active:scale-100",
            checked ? "border-slate-900 bg-slate-900" : "border-slate-300 bg-white",
          )}
        >
          <FontAwesomeIcon
            icon={faCheck}
            className={cn(
              "size-3 text-amber-300 transition-[opacity,transform] duration-150 motion-reduce:transition-none",
              checked ? "scale-100 opacity-100" : "scale-75 opacity-0",
            )}
          />
        </span>
        <span className="min-w-0">
          <span className="block leading-6">{label}</span>
          {description && <span id={descriptionId} className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span>}
        </span>
      </span>
    </label>
  );
}
