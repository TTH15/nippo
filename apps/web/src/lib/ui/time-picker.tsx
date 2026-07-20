"use client";

// @platform/ui の time-picker のローカル適応版（lib/ui の他コンポーネント同様、
// shadcn セマンティックトークンを本プロジェクトの slate 直指定に置き換えている）。
// ロジックを変える修正は原本 ~/Developer/packages/ui/src/time-picker.tsx へ先に入れること。
import * as React from "react";
import { Clock } from "lucide-react";

import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "./utils";

export interface TimePickerProps {
  /** "HH:MM"（DB の time 型と互換の文字列）。null/undefined = 未選択 */
  value?: string | null;
  onChange?: (value: string | null) => void;
  placeholder?: string;
  /** 分の刻み（既定 5。1〜30） */
  minuteStep?: number;
  /** 未選択に戻す「クリア」を出す（既定 true） */
  clearable?: boolean;
  disabled?: boolean;
  buttonClassName?: string;
  contentClassName?: string;
  iconClassName?: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function parseValue(v?: string | null): { hour: number | null; minute: number | null } {
  if (!v) return { hour: null, minute: null };
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  if (!m) return { hour: null, minute: null };
  return {
    hour: Math.min(23, parseInt(m[1], 10)),
    minute: Math.min(59, parseInt(m[2], 10)),
  };
}

/**
 * Button + Popover の時刻ピッカー（時・分の2カラム選択）。
 * ネイティブ input[type=time] のデスクトップでの扱いにくさ（スピナー・書式ゆれ）を避け、
 * DatePicker と対になる操作感を提供する。時を選ぶと開いたまま、分を選ぶと閉じる。
 */
export function TimePicker({
  value,
  onChange,
  placeholder = "時刻を選択",
  minuteStep = 5,
  clearable = true,
  disabled,
  buttonClassName,
  contentClassName,
  iconClassName,
}: TimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const { hour, minute } = parseValue(value);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const step = Math.max(1, Math.min(30, Math.floor(minuteStep)));
  const minutes: number[] = [];
  for (let m = 0; m < 60; m += step) minutes.push(m);
  // 刻みに乗らない既存値（例: 07:03）もリストへ含めて選択状態を表示できるようにする
  if (minute != null && !minutes.includes(minute)) {
    minutes.push(minute);
    minutes.sort((a, b) => a - b);
  }

  // 開いたとき、選択中の時・分を各列の中央へスクロールする
  const listsRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      listsRef.current
        ?.querySelectorAll<HTMLElement>("[data-active='true']")
        .forEach((el) => el.scrollIntoView({ block: "center" }));
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const selectHour = (h: number) => onChange?.(`${pad2(h)}:${pad2(minute ?? 0)}`);
  const selectMinute = (m: number) => {
    onChange?.(`${pad2(hour ?? 0)}:${pad2(m)}`);
    setOpen(false);
  };

  const column = (
    label: string,
    items: number[],
    selected: number | null,
    onSelect: (n: number) => void,
  ) => (
    <div className="flex flex-col">
      <span className="pb-1 text-center text-[10px] font-medium text-slate-500">{label}</span>
      <div className="h-52 w-14 overflow-y-auto rounded-md border border-slate-200 p-1">
        {items.map((n) => (
          <button
            key={n}
            type="button"
            data-active={n === selected || undefined}
            onClick={() => onSelect(n)}
            className={cn(
              "block w-full rounded px-2 py-1.5 text-center text-sm tabular-nums transition-colors",
              n === selected ? "bg-slate-900 text-white" : "hover:bg-slate-100",
            )}
          >
            {pad2(n)}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal tabular-nums",
            !value && "text-slate-400",
            buttonClassName,
          )}
        >
          <Clock className={cn("mr-2 size-4", iconClassName)} />
          {value ? value.slice(0, 5) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("w-auto p-2", contentClassName)}>
        <div ref={listsRef} className="flex gap-2">
          {column("時", hours, hour, selectHour)}
          {column("分", minutes, minute, selectMinute)}
        </div>
        {clearable && value ? (
          <button
            type="button"
            onClick={() => {
              onChange?.(null);
              setOpen(false);
            }}
            className="mt-2 w-full rounded-md py-1.5 text-center text-xs text-slate-500 transition-colors hover:bg-slate-100"
          >
            クリア（未設定に戻す）
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
