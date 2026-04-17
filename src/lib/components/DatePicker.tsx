"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar } from "@/lib/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/ui/popover";
import { Button } from "@/lib/ui/button";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { cn } from "@/lib/ui/utils";

export type DatePickerValue = Date | undefined;

export interface DatePickerProps {
  value?: DatePickerValue;
  onChange?: (date: DatePickerValue) => void;
  placeholder?: string;
  /** ボタン幅。デフォルトは w-full（親幅に合わせる） */
  className?: string;
  /** 選択可能な最小日付（この日以降のみ選択可能） */
  fromDate?: Date;
  /** 選択可能な最大日付（この日まで選択可能） */
  toDate?: Date;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "日付を選択",
  className,
  fromDate,
  toDate,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const baseDate = value ?? toDate ?? fromDate ?? new Date();
  const minYear = fromDate?.getFullYear() ?? baseDate.getFullYear() - 20;
  const maxYear = toDate?.getFullYear() ?? baseDate.getFullYear() + 20;
  const [viewMonth, setViewMonth] = useState<Date>(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1));

  useEffect(() => {
    if (!open) return;
    const next = value ?? toDate ?? fromDate ?? new Date();
    setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  }, [open, value, toDate, fromDate]);

  const yearOptions = useMemo(() => {
    const from = Math.min(minYear, maxYear);
    const to = Math.max(minYear, maxYear);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [minYear, maxYear]);

  const clampMonthInRange = (date: Date) => {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    if (fromDate) {
      const fromMonthStart = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
      if (monthStart < fromMonthStart) return fromMonthStart;
    }
    if (toDate) {
      const toMonthStart = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
      if (monthStart > toMonthStart) return toMonthStart;
    }
    return monthStart;
  };

  const handleYearChange = (nextYear: number) => {
    const next = clampMonthInRange(new Date(nextYear, viewMonth.getMonth(), 1));
    setViewMonth(next);
  };

  const handleMonthChange = (nextMonth: number) => {
    const next = clampMonthInRange(new Date(viewMonth.getFullYear(), nextMonth, 1));
    setViewMonth(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("justify-start text-left font-normal", className ?? "w-full")}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {value ? format(value, "yyyy年MM月dd日", { locale: ja }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
          <select
            aria-label="年を選択"
            value={viewMonth.getFullYear()}
            onChange={(e) => handleYearChange(Number(e.target.value))}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}年
              </option>
            ))}
          </select>
          <select
            aria-label="月を選択"
            value={viewMonth.getMonth()}
            onChange={(e) => handleMonthChange(Number(e.target.value))}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
          >
            {Array.from({ length: 12 }, (_, month) => (
              <option key={month} value={month}>
                {month + 1}月
              </option>
            ))}
          </select>
        </div>
        <Calendar
          mode="single"
          month={viewMonth}
          onMonthChange={(next) => setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1))}
          selected={value}
          onSelect={(date) => {
            onChange?.(date);
            setOpen(false);
          }}
          fromDate={fromDate}
          toDate={toDate}
          disabled={
            fromDate != null || toDate != null
              ? (date) => {
                  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
                  if (fromDate) {
                    const f = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()).getTime();
                    if (d < f) return true;
                  }
                  if (toDate) {
                    const t = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate()).getTime();
                    if (d > t) return true;
                  }
                  return false;
                }
              : undefined
          }
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
