"use client";

import { useState } from "react";
import { Calendar } from "@/lib/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/lib/ui/popover";
import { Button } from "@/lib/ui/button";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { cn } from "@/lib/ui/utils";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

export type DatePickerValue = Date | undefined;

export interface DatePickerProps {
  value?: DatePickerValue;
  id?: string;
  ariaLabel?: string;
  displayFormat?: string;
  onChange?: (date: DatePickerValue) => void;
  placeholder?: string;
  /** ボタン幅。デフォルトは w-full（親幅に合わせる） */
  className?: string;
  /** 選択可能な最小日付（この日以降のみ選択可能） */
  fromDate?: Date;
  /** 選択可能な最大日付（この日まで選択可能） */
  toDate?: Date;
  /** 無効化（押下不可・薄表示） */
  disabled?: boolean;
}

export function DatePicker({
  value,
  id,
  ariaLabel,
  displayFormat = "yyyy年MM月dd日",
  onChange,
  placeholder = "日付を選択",
  className,
  fromDate,
  toDate,
  disabled,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  useBodyScrollLock(open && !disabled);

  return (
    <Popover open={open && !disabled} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          aria-label={ariaLabel}
          variant="outline"
          disabled={disabled}
          className={cn("justify-start text-left font-normal", className ?? "w-full")}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {value ? format(value, displayFormat, { locale: ja }) : placeholder}
        </Button>
      </PopoverTrigger>
      {/* 320px 幅では既定の 368px がはみ出し、土曜と「次の月へ」が画面外になる。
          画面に収まる範囲で横スクロールできるようにする（共有部品・全画面に効く） */}
      <PopoverContent className="w-auto max-w-[calc(100vw-1rem)] overflow-x-auto p-0" align="start" collisionPadding={8}>
        <Calendar
          mode="single"
          selected={value}
          defaultMonth={value}
          onSelect={(date) => {
            onChange?.(date);
            setOpen(false);
          }}
          fromDate={fromDate}
          toDate={toDate}
          // v9 は fromDate/toDate では**月送りを止めない**。選べない月を延々めくれてしまうので
          // 表示できる月そのものを縛る
          startMonth={fromDate}
          endMonth={toDate}
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
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
