import { useState, useEffect } from "react";
import { DateRangeDualPicker } from "@/lib/components/DateRangeDualPicker";
import { startOfMonth, endOfMonth, subMonths } from "date-fns";
import { motion } from "motion/react";

type RangePreset = "last_month" | "current_month" | "six_months" | "one_year" | "custom";

export type DateRangeValue = {
  startDate?: Date;
  endDate?: Date;
};

const PRESET_LABELS: Record<RangePreset, string> = {
  last_month: "先月",
  current_month: "今月",
  six_months: "半年",
  one_year: "1年",
  custom: "カスタム",
};

const ALL_PRESETS: RangePreset[] = ["last_month", "current_month", "six_months", "one_year", "custom"];

interface DateRangePickerProps {
  value?: DateRangeValue;
  onChange?: (range: DateRangeValue) => void;
  /** 表示するプリセットの絞り込み（省略時は全部）。例: ["last_month","current_month","custom"] */
  presets?: RangePreset[];
}

export function DateRangePicker({ value, onChange, presets: presetKeys }: DateRangePickerProps) {
  const [preset, setPreset] = useState<RangePreset>("current_month");

  useEffect(() => {
    const today = new Date();
    let startDate: Date;
    let endDate: Date;

    if (preset !== "custom") {
      switch (preset) {
        case "last_month":
          startDate = startOfMonth(subMonths(today, 1));
          endDate = endOfMonth(subMonths(today, 1));
          break;
        case "current_month":
          startDate = startOfMonth(today);
          endDate = endOfMonth(today);
          break;
        case "six_months":
          startDate = startOfMonth(subMonths(today, 5));
          endDate = endOfMonth(today);
          break;
        case "one_year":
          startDate = startOfMonth(subMonths(today, 11));
          endDate = endOfMonth(today);
          break;
        default:
          return;
      }

      onChange?.({ startDate, endDate });
    }
  }, [preset, onChange]);

  const handlePresetChange = (next: RangePreset) => {
    setPreset(next);
  };

  const handleCustomRangeChange = (range: DateRangeValue) => {
    onChange?.(range);
    setPreset("custom");
  };

  const presets = (presetKeys ?? ALL_PRESETS).map((value) => ({ value, label: PRESET_LABELS[value] }));

  return (
    <div className="flex flex-col sm:flex-row items-start gap-4">
      <div className="relative inline-flex gap-1 bg-slate-100 p-1 rounded-lg backdrop-blur-sm h-[58px] items-center">
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => handlePresetChange(p.value)}
            className={`relative px-5 h-full text-sm rounded-md transition-colors z-10 whitespace-nowrap ${
              preset === p.value
                ? "text-white"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {preset === p.value && (
              <motion.div
                layoutId="preset-background"
                className="absolute inset-0 bg-slate-900 rounded-md"
                style={{ zIndex: -1 }}
                transition={{
                  type: "spring",
                  stiffness: 500,
                  damping: 35,
                }}
              />
            )}
            {p.label}
          </button>
        ))}
      </div>

      <DateRangeDualPicker value={value} onChange={handleCustomRangeChange} />
    </div>
  );
}

