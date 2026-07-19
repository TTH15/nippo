"use client";

import * as React from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { DayPicker, useDayPicker, type MonthCaptionProps } from "react-day-picker";
import { ja as rdpJa } from "react-day-picker/locale";

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
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const settleTimerRef = React.useRef<number | null>(null);
  const ITEM_HEIGHT = 40;
  const TOP_PADDING = 68;

  const getNearestIndex = React.useCallback(
    (scrollTop: number, viewportHeight: number) => {
      const viewportCenterY = scrollTop + viewportHeight / 2;
      const rawIndex = (viewportCenterY - TOP_PADDING - ITEM_HEIGHT / 2) / ITEM_HEIGHT;
      return Math.max(0, Math.min(values.length - 1, Math.round(rawIndex)));
    },
    [values.length],
  );

  const scrollToIndex = React.useCallback(
    (index: number, behavior: ScrollBehavior) => {
      const el = containerRef.current;
      if (!el) return;
      const nextTop = TOP_PADDING + index * ITEM_HEIGHT + ITEM_HEIGHT / 2 - el.clientHeight / 2;
      el.scrollTo({ top: nextTop, behavior });
    },
    [],
  );

  React.useEffect(() => {
    const index = values.indexOf(value);
    if (index < 0) return;
    scrollToIndex(index, "auto");
  }, [value, values, scrollToIndex]);

  React.useEffect(() => {
    return () => {
      if (settleTimerRef.current != null) {
        window.clearTimeout(settleTimerRef.current);
      }
    };
  }, []);

  const handleScroll = () => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = window.setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const index = getNearestIndex(el.scrollTop, el.clientHeight);
      const nextValue = values[index];
      if (nextValue !== value) onChange(nextValue);
      scrollToIndex(index, "smooth");
    }, 90);
  };

  return (
    <div className="relative h-44 overflow-hidden rounded-md">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-white via-white/90 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-white via-white/90 to-transparent" />
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full snap-y snap-mandatory overflow-y-auto py-[68px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {values.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              "block h-10 w-full snap-center px-2 text-center text-base transition-colors",
              v === value ? "font-semibold text-slate-900" : "text-slate-400 hover:text-slate-700",
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
  // v9: useNavigation は廃止され、goToMonth は useDayPicker が提供する
  const { goToMonth } = useDayPicker();
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
    goToMonth?.(new Date(selectedYear, selectedMonth, 1));
  }, [open, selectedYear, selectedMonth, goToMonth]);

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
          <div className="mt-3 flex justify-start">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// v9: CaptionLabel(displayMonth) は廃止。MonthCaption が calendarMonth を受け取る
function CustomMonthCaption({ calendarMonth, displayIndex: _displayIndex, ...divProps }: MonthCaptionProps) {
  return (
    <div {...divProps}>
      <CaptionLabelButton displayMonth={calendarMonth.date} />
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
      locale={rdpJa}
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
      // v9 の classNames キー体系(v8: caption→month_caption, table→month_grid,
      // cell→day, day→day_button 等)。aria-selected/data 属性は td(day)側に付く
      classNames={{
        months: "relative flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "size-9 bg-transparent p-0 opacity-50 hover:opacity-100 z-10 ml-1",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "size-9 bg-transparent p-0 opacity-50 hover:opacity-100 z-10 mr-1",
        ),
        month_grid: "w-full border-collapse space-x-1",
        weekdays: "flex",
        weekday: "text-slate-400 rounded-md w-12 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 aria-selected:bg-slate-100",
          props.mode === "range"
            ? "first:aria-selected:rounded-l-md last:aria-selected:rounded-r-md"
            : "aria-selected:rounded-md",
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "size-12 p-0 font-normal text-base hover:bg-slate-100",
        ),
        range_start:
          "rounded-l-md [&>button]:bg-slate-900 [&>button]:text-white [&>button:hover]:bg-slate-800 [&>button:hover]:text-white",
        range_end:
          "rounded-r-md [&>button]:bg-slate-900 [&>button]:text-white [&>button:hover]:bg-slate-800 [&>button:hover]:text-white",
        selected:
          "[&>button]:bg-slate-900 [&>button]:text-white [&>button:hover]:bg-slate-800 [&>button:hover]:text-white [&>button:focus]:bg-slate-900 [&>button:focus]:text-white",
        range_middle:
          "bg-slate-100 [&>button]:bg-transparent [&>button]:text-slate-900",
        today: "[&>button]:bg-slate-100 [&>button]:text-slate-900 [&>button]:font-semibold",
        outside: "text-slate-300 opacity-40",
        disabled: "text-slate-300 opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        MonthCaption: CustomMonthCaption,
        // v9: IconLeft/IconRight は Chevron に統合された
        Chevron: ({ orientation, className: chevronClassName }) => {
          const Icon =
            orientation === "left"
              ? ChevronLeft
              : orientation === "right"
                ? ChevronRight
                : orientation === "up"
                  ? ChevronUp
                  : ChevronDown;
          return <Icon className={cn("size-4", chevronClassName)} />;
        },
      }}
      {...props}
    />
  );
}

export { Calendar };
