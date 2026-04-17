"use client";

import * as React from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, useNavigation } from "react-day-picker";
import { ja } from "date-fns/locale";

import { cn } from "./utils";
import { buttonVariants } from "./button";

function MonthYearWheel({
  value,
  values,
  toLabel,
  onChange,
}: {
  value: number;
  values: number[];
  toLabel: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="relative h-44 overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="pointer-events-none absolute inset-x-1 top-1/2 z-10 h-10 -translate-y-1/2 rounded-md bg-slate-100/80" />
      <div className="h-full overflow-y-auto py-[68px] scrollbar-thin">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              "block h-10 w-full snap-center px-2 text-center text-base transition-colors",
              v === value ? "font-semibold text-slate-900" : "text-slate-500 hover:text-slate-700",
            )}
          >
            {toLabel(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

function CaptionLabelButton(props: { displayMonth: Date }) {
  const { goToMonth } = useNavigation();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [selectedYear, setSelectedYear] = React.useState(props.displayMonth.getFullYear());
  const [selectedMonth, setSelectedMonth] = React.useState(props.displayMonth.getMonth());
  const currentYear = new Date().getFullYear();
  const years = React.useMemo(
    () => Array.from({ length: 121 }, (_, i) => currentYear - 60 + i),
    [currentYear],
  );
  const months = React.useMemo(() => Array.from({ length: 12 }, (_, i) => i), []);

  React.useEffect(() => {
    if (!open) {
      setSelectedYear(props.displayMonth.getFullYear());
      setSelectedMonth(props.displayMonth.getMonth());
    }
  }, [open, props.displayMonth]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const applyMonth = () => {
    goToMonth?.(new Date(selectedYear, selectedMonth, 1));
    setOpen(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-slate-800 hover:bg-slate-100"
      >
        {format(props.displayMonth, "M月 yyyy", { locale: ja })}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="absolute left-1/2 top-[calc(100%+8px)] z-50 w-[300px] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="grid grid-cols-2 gap-2">
            <MonthYearWheel
              value={selectedMonth}
              values={months}
              toLabel={(m) => `${m + 1}月`}
              onChange={setSelectedMonth}
            />
            <MonthYearWheel
              value={selectedYear}
              values={years}
              toLabel={(y) => `${y}年`}
              onChange={setSelectedYear}
            />
          </div>
          <div className="mt-3 flex justify-between">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              閉じる
            </button>
            <button
              type="button"
              onClick={applyMonth}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              決定
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      locale={ja}
      showOutsideDays={showOutsideDays}
      className={cn("p-4", className)}
      modifiers={{
        saturday: (date) => date.getDay() === 6,
        sunday: (date) => date.getDay() === 0,
      }}
      modifiersClassNames={{
        saturday: "text-blue-600",
        sunday: "text-red-600",
      }}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "size-9 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-x-1",
        head_row: "flex",
        head_cell:
          "text-slate-400 rounded-md w-12 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-slate-100 [&:has([aria-selected].day-range-end)]:rounded-r-md",
          props.mode === "range"
            ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            : "[&:has([aria-selected])]:rounded-md",
        ),
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "size-12 p-0 font-normal aria-selected:opacity-100 text-base hover:bg-slate-100",
        ),
        day_range_start:
          "day-range-start aria-selected:bg-slate-900 aria-selected:text-white",
        day_range_end:
          "day-range-end aria-selected:bg-slate-900 aria-selected:text-white",
        day_selected:
          "bg-slate-900 text-white hover:bg-slate-800 hover:text-white focus:bg-slate-900 focus:text-white",
        day_today: "bg-slate-100 text-slate-900 font-semibold",
        day_outside:
          "day-outside text-slate-300 aria-selected:text-slate-300 opacity-40",
        day_disabled: "text-slate-300 opacity-50",
        day_range_middle:
          "aria-selected:bg-slate-100 aria-selected:text-slate-900",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        CaptionLabel: ({ displayMonth }) => <CaptionLabelButton displayMonth={displayMonth} />,
        IconLeft: ({ className, ...props }) => (
          <ChevronLeft className={cn("size-4", className)} {...props} />
        ),
        IconRight: ({ className, ...props }) => (
          <ChevronRight className={cn("size-4", className)} {...props} />
        ),
      }}
      {...props}
    />
  );
}

export { Calendar };

