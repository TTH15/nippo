"use client";

import { useState, useRef, useEffect } from "react";
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
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  /** トリガーの高さ・スタイルをコンパクトにする */
  size?: "default" | "sm";
  className?: string;
}

export function CustomSelect({
  options,
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
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
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

  const isSm = size === "sm";
  const triggerHeight = isSm ? "h-9" : "h-14";
  const triggerPadding = isSm ? "px-3 py-2" : "px-4";
  const optionPadding = isSm ? "py-2 px-3" : "py-3 px-4";

  return (
    <div ref={containerRef} className={`relative w-full ${className ?? ""}`} onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        className={`
          w-full ${triggerHeight} ${triggerPadding} flex items-center justify-between gap-2
          bg-white border-2 border-slate-200 rounded-xl
          transition-all duration-200
          ${disabled ? "opacity-50 cursor-not-allowed" : "hover:border-slate-300 focus:border-slate-500 focus:outline-none focus:ring-4 focus:ring-slate-100"}
          ${isOpen ? "border-slate-500 ring-4 ring-slate-100" : ""}
        `}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selectedOption?.icon && (
            <div className="flex-shrink-0 text-slate-600">{selectedOption.icon}</div>
          )}
          <div className="text-left flex-1 min-w-0">
            {selectedOption ? (
              <>
                <div className={`font-medium text-slate-900 truncate ${isSm ? "text-sm" : ""}`}>
                  {selectedOption.label}
                </div>
                {selectedOption.description && !isSm && (
                  <div className="text-sm text-slate-500 truncate">{selectedOption.description}</div>
                )}
              </>
            ) : (
              <div className={`text-slate-400 ${isSm ? "text-sm" : ""}`}>{placeholder}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {clearable && selectedOption && !disabled && (
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
            <ChevronDown className={`text-slate-400 ${isSm ? "w-4 h-4" : "w-5 h-5"}`} />
          </motion.div>
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="absolute z-[9999] w-full mt-2 bg-white border-2 border-slate-200 rounded-xl shadow-xl overflow-hidden"
          >
            <div className="max-h-[280px] overflow-y-auto">
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
                        w-full ${optionPadding} flex items-center gap-2
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
                          className={`truncate ${isSm ? "text-sm" : ""} ${
                            isSelected ? "text-slate-700 font-medium" : "text-slate-900"
                          }`}
                        >
                          {option.label}
                        </div>
                        {option.description && !isSm && (
                          <div className="text-sm text-slate-500 truncate">{option.description}</div>
                        )}
                      </div>
                      {isSelected && (
                        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex-shrink-0">
                          <Check className={`text-slate-600 ${isSm ? "w-4 h-4" : "w-5 h-5"}`} />
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
        )}
      </AnimatePresence>
    </div>
  );
}
