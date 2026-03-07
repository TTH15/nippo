"use client";

import { useState } from "react";
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
        <Calendar
          mode="single"
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
