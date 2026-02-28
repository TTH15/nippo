"use client";

import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/ui/popover";
import { Button } from "@/lib/ui/button";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

export interface MonthYearPickerProps {
  value?: { year: number; month: number };
  onChange?: (value: { year: number; month: number }) => void;
  placeholder?: string;
}

const MONTHS = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
];

export function MonthYearPicker({
  value,
  onChange,
  placeholder = "年月を選択",
}: MonthYearPickerProps) {
  const [open, setOpen] = useState(false);
  const currentYear = new Date().getFullYear();
  const [displayYear, setDisplayYear] = useState(value?.year ?? currentYear);

  useEffect(() => {
    if (open) {
      setDisplayYear(value?.year ?? currentYear);
    }
  }, [open, value?.year, currentYear]);

  const handleSelect = (month: number) => {
    onChange?.({ year: displayYear, month });
    setOpen(false);
  };

  const formatValue = () => {
    if (!value) return placeholder;
    return `${value.year}年${value.month}月`;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-[180px] justify-start text-left font-normal"
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {formatValue()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-4" align="start">
        <div className="space-y-4">
          {/* Year Navigation */}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setDisplayYear(displayYear - 1)}
              className="h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-sm font-semibold">
              {displayYear}年
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setDisplayYear(displayYear + 1)}
              className="h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Month Grid */}
          <div className="grid grid-cols-3 gap-2">
            {MONTHS.map((monthName, index) => {
              const monthNumber = index + 1;
              const isSelected =
                value?.year === displayYear && value?.month === monthNumber;

              return (
                <Button
                  key={monthNumber}
                  variant={isSelected ? "default" : "outline"}
                  className="h-12 text-sm"
                  onClick={() => handleSelect(monthNumber)}
                >
                  {monthName}
                </Button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
