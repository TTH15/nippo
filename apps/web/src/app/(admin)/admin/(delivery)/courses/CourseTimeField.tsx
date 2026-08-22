"use client";

import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClock } from "@fortawesome/free-solid-svg-icons";
import { TimePicker } from "@/lib/ui/time-picker";

function normalizeTimeText(raw: string): string {
  return raw
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9:]/g, "")
    .slice(0, 5);
}

export function normalizeCourseTime(raw: string): string {
  const normalized = normalizeTimeText(raw);
  const digits = normalized.replace(/:/g, "");
  if (!digits) return "";
  const [rawHour, rawMinute] = normalized.includes(":")
    ? normalized.split(":")
    : digits.length <= 2
      ? [digits, "0"]
      : [digits.slice(0, -2), digits.slice(-2)];
  const hour = Math.min(23, Number(rawHour) || 0);
  const minute = Math.min(59, Number(rawMinute) || 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function CourseTimeField({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [text, setText] = useState(value ?? "");
  const composingRef = useRef(false);

  useEffect(() => {
    if (!composingRef.current) setText(value ?? "");
  }, [value]);

  const commit = (raw: string) => {
    const next = normalizeCourseTime(raw);
    setText(next);
    onChange(next || null);
  };
  const moveByFiveMinutes = (direction: 1 | -1) => {
    const normalized = normalizeCourseTime(text) || "00:00";
    const [hour, minute] = normalized.split(":").map(Number);
    const total = (hour * 60 + minute + direction * 5 + 24 * 60) % (24 * 60);
    const next = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    setText(next);
    onChange(next);
  };

  return (
    <>
      <div className="relative hidden md:block">
        <input
          type="text"
          inputMode="numeric"
          value={text}
          disabled={disabled}
          placeholder="--:--"
          aria-label={ariaLabel}
          title="4桁入力可（930 → 09:30）。上下キーで5分ずつ変更できます"
          onFocus={(event) => event.currentTarget.select()}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            setText(normalizeTimeText(event.currentTarget.value));
          }}
          onChange={(event) => {
            setText(composingRef.current ? event.target.value : normalizeTimeText(event.target.value));
          }}
          onBlur={() => {
            composingRef.current = false;
            commit(text);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              moveByFiveMinutes(event.key === "ArrowUp" ? 1 : -1);
            }
          }}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm tabular-nums text-slate-800 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:bg-slate-100 disabled:text-slate-400"
        />
        <FontAwesomeIcon icon={faClock} className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      </div>
      <div className="md:hidden">
        <TimePicker
          value={value}
          onChange={onChange}
          placeholder="--:--"
          disabled={disabled}
          buttonClassName="w-full px-2.5"
        />
      </div>
    </>
  );
}
