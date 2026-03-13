"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, X } from "lucide-react";
import type { SelectOption } from "./CustomSelect";

interface SimpleSelectProps {
  options: SelectOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  size?: "default" | "sm" | "md";
  className?: string;
}

export function SimpleSelect({
  options,
  value,
  onChange,
  placeholder = "選択してください",
  clearable = true,
  disabled = false,
  size = "default",
  className,
}: SimpleSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", onClick);
    }
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const isSm = size === "sm";
  const isMd = size === "md";
  const triggerHeight = isSm ? "h-9" : isMd ? "h-12" : "h-14";
  const triggerPadding = isSm || isMd ? "px-3 py-2" : "px-4";

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className ?? ""}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`
          w-full ${triggerHeight} ${triggerPadding} flex items-center justify-between gap-2
          bg-white border-2 border-slate-200 rounded-xl
          text-left
          ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-slate-300 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-100"}
        `}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="text-left flex-1 min-w-0">
            {selected ? (
              <div className={`font-medium text-slate-900 truncate ${isSm || isMd ? "text-sm" : ""}`}>
                {selected.label}
              </div>
            ) : (
              <div className={`text-slate-400 ${isSm || isMd ? "text-sm" : ""}`}>{placeholder}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {clearable && selected && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="hover:bg-slate-100 rounded-full p-0.5"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>
          )}
          <ChevronDown className={`text-slate-400 ${isSm || isMd ? "w-4 h-4" : "w-5 h-5"}`} />
        </div>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-md max-h-64 overflow-auto">
          {options.length === 0 ? (
            <div className="px-3 py-3 text-center text-xs text-slate-400">該当する項目がありません</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={`
                  w-full px-3 py-2 text-left text-sm
                  hover:bg-slate-50
                  ${opt.value === value ? "bg-slate-50 text-slate-900 font-medium" : "text-slate-800"}
                `}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

