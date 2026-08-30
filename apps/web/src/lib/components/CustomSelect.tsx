"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Check, ChevronDown, X } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  options: SelectOption[];
  id?: string;
  ariaLabel?: string;
  triggerClassName?: string;
  showSelectedDescription?: boolean;
  showOptionDescriptions?: boolean;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  /** トリガーの高さ・スタイルをコンパクトにする（xs はシフト表など高密度向け） */
  size?: "default" | "sm" | "md" | "xs";
  className?: string;
}

export function CustomSelect({
  options,
  id,
  ariaLabel,
  triggerClassName,
  showSelectedDescription = true,
  showOptionDescriptions = false,
  value,
  onChange,
  placeholder = "選択してください",
  clearable = true,
  disabled = false,
  size = "default",
  className,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [dropdownRect, setDropdownRect] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  const PREFERRED_MAX_HEIGHT = 280;

  useLayoutEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const el = containerRef.current;
    if (!el) return;
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    // 下側のスペースが足りず、上側の方が広ければ上向きに開く
    const openUp = spaceBelow < PREFERRED_MAX_HEIGHT && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(PREFERRED_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow));
    setDropdownRect(
      openUp
        ? { bottom: window.innerHeight - rect.top + margin, left: rect.left, width: rect.width, maxHeight }
        : { top: rect.bottom + margin, left: rect.left, width: rect.width, maxHeight },
    );
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setIsOpen(false);
      setFocusedIndex(-1);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    switch (e.key) {
      case "Enter":
        e.preventDefault();
        if (isOpen && focusedIndex >= 0 && focusedIndex < options.length) {
          onChange(options[focusedIndex].value);
          setIsOpen(false);
          setFocusedIndex(-1);
        } else if (!isOpen) {
          setIsOpen(true);
        }
        break;
      case "Escape":
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setFocusedIndex((prev) => (prev < options.length - 1 ? prev + 1 : prev));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (isOpen) {
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        }
        break;
    }
  };

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setFocusedIndex(-1);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  const toggleOpen = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
      if (isOpen) {
        setFocusedIndex(-1);
      }
    }
  };

  const isXs = size === "xs";
  const isSm = size === "sm";
  const isMd = size === "md";
  const triggerHeight = isXs ? "min-h-7 h-7" : isSm ? "h-9" : isMd ? "h-12" : "h-14";
  const triggerPadding = isXs ? "px-1.5 py-0.5" : isSm ? "px-3 py-2" : isMd ? "px-3 py-2" : "px-4";
  const optionPadding = isXs ? "py-1.5 px-2" : isSm ? "py-2 px-3" : isMd ? "py-2.5 px-3" : "py-3 px-4";
  const compactLabel = isXs || isSm || isMd;

  return (
    <div ref={containerRef} className={`relative w-full ${className ?? ""}`} onKeyDown={handleKeyDown}>
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={toggleOpen}
        disabled={disabled}
        className={`
          w-full ${triggerHeight} ${triggerPadding} flex items-center justify-between ${isXs ? "gap-0.5" : "gap-2"}
          bg-white border-2 border-slate-200 ${isXs ? "rounded-lg" : "rounded-xl"}
          transition-all duration-200
          ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-slate-300 focus:border-slate-500 focus:outline-none " + (isXs ? "focus:ring-2 focus:ring-slate-200" : "focus:ring-4 focus:ring-slate-100")}
          ${triggerClassName ?? ""}
          ${isOpen ? (isXs ? "border-slate-500 ring-2 ring-slate-200" : "border-slate-500 ring-4 ring-slate-100") : ""}
        `}
      >
        <div className={`flex items-center ${isXs ? "gap-0.5" : "gap-2"} flex-1 min-w-0`}>
          {selectedOption?.icon && (
            <div className="flex-shrink-0 text-slate-600">{selectedOption.icon}</div>
          )}
          <div className="text-left flex-1 min-w-0">
            {selectedOption ? (
              <>
                <div
                  className={`font-medium text-slate-900 truncate leading-tight ${isXs ? "text-[11px]" : compactLabel ? "text-sm" : ""}`}
                >
                  {selectedOption.label}
                </div>
                {showSelectedDescription && selectedOption.description && !isSm && !isXs && (
                  <div className="text-sm text-slate-500 truncate">{selectedOption.description}</div>
                )}
              </>
            ) : (
              <div className={`text-slate-400 ${isXs ? "text-[11px]" : compactLabel ? "text-sm" : ""}`}>
                {placeholder}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {clearable && selectedOption && !disabled && !isXs && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="hover:bg-slate-100 rounded-full p-0.5"
              onClick={handleClear}
            >
              <X className="w-4 h-4 text-slate-400" />
            </motion.div>
          )}
          <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown
              className={`text-slate-400 shrink-0 ${isXs ? "w-3 h-3" : isSm || isMd ? "w-4 h-4" : "w-5 h-5"}`}
            />
          </motion.div>
        </div>
      </button>

      {typeof document !== "undefined" &&
        isOpen &&
        dropdownRect &&
        createPortal(
          <AnimatePresence>
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: dropdownRect.bottom !== undefined ? 10 : -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: dropdownRect.bottom !== undefined ? 10 : -10 }}
              transition={{ duration: 0.2 }}
              className={`fixed z-[9999] bg-white border-2 border-slate-200 shadow-xl overflow-hidden ${isXs ? "rounded-lg border-slate-200" : "rounded-xl"}`}
              style={{
                top: dropdownRect.top,
                bottom: dropdownRect.bottom,
                left: dropdownRect.left,
                width: dropdownRect.width,
              }}
            >
              <div className="overflow-y-auto" style={{ maxHeight: dropdownRect.maxHeight }}>
                {options.length > 0 ? (
                  options.map((option, index) => {
                    const isSelected = option.value === value;
                    const isFocused = index === focusedIndex;

                    return (
                      <motion.button
                        key={option.value}
                        type="button"
                        onClick={() => handleSelect(option.value)}
                        onMouseEnter={() => setFocusedIndex(index)}
                        className={`
                          w-full ${optionPadding} flex items-center ${isXs ? "gap-1" : "gap-2"}
                          transition-colors duration-150
                          ${isFocused ? "bg-slate-100" : "hover:bg-slate-50"}
                          ${isSelected ? "bg-slate-50" : ""}
                        `}
                        whileHover={{ x: 4 }}
                        transition={{ duration: 0.15 }}
                      >
                        {option.icon && (
                          <div className="flex-shrink-0 text-slate-600">{option.icon}</div>
                        )}
                        <div className="flex-1 text-left min-w-0">
                          <div
                            className={`truncate ${isXs ? "text-[11px] leading-tight" : isSm || isMd ? "text-sm" : ""} ${
                              isSelected ? "text-slate-700 font-medium" : "text-slate-900"
                            }`}
                          >
                            {option.label}
                          </div>
                          {option.description && (showOptionDescriptions || (!isSm && !isMd && !isXs)) && (
                            <div className={`text-slate-500 ${showOptionDescriptions ? "text-xs leading-5" : "text-sm truncate"}`}>{option.description}</div>
                          )}
                        </div>
                        {isSelected && (
                          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex-shrink-0">
                            <Check
                              className={`text-slate-600 ${isXs ? "w-3.5 h-3.5" : isSm || isMd ? "w-4 h-4" : "w-5 h-5"}`}
                            />
                          </motion.div>
                        )}
                      </motion.button>
                    );
                  })
                ) : (
                  <div className="px-4 py-6 text-center text-slate-400 text-sm">該当する項目がありません</div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
