import { useState, useEffect } from "react";
import { DateRangeDualPicker } from "@/lib/components/DateRangeDualPicker";
import { startOfMonth, subMonths } from "date-fns";
import { motion } from "motion/react";

type RangePreset = "current_month" | "six_months" | "one_year" | "custom";

export type DateRangeValue = {
  startDate?: Date;
  endDate?: Date;
};

interface DateRangePickerProps {
  value?: DateRangeValue;
  onChange?: (range: DateRangeValue) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [preset, setPreset] = useState<RangePreset>("current_month");

  useEffect(() => {
    const today = value?.endDate ?? new Date();
    let startDate: Date;
    let endDate: Date = today;

    if (preset !== "custom") {
      switch (preset) {
        case "current_month":
          startDate = startOfMonth(today);
          break;
        case "six_months":
          startDate = startOfMonth(subMonths(today, 5));
          break;
        case "one_year":
          startDate = startOfMonth(subMonths(today, 11));
          break;
        default:
          return;
      }

      onChange?.({ startDate, endDate });
    }
  }, [preset, onChange, value?.endDate]);

  const handlePresetChange = (next: RangePreset) => {
    setPreset(next);
  };

  const handleCustomRangeChange = (range: DateRangeValue) => {
    onChange?.(range);
    setPreset("custom");
  };

  const presets = [
    { value: "current_month", label: "今月" },
    { value: "six_months", label: "半年" },
    { value: "one_year", label: "1年" },
    { value: "custom", label: "カスタム" },
  ] as const;

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

