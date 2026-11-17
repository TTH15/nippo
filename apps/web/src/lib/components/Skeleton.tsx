"use client";

import { cn } from "@/lib/ui/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("min-w-0 max-w-full animate-pulse rounded bg-slate-200", className)}
      aria-hidden
    />
  );
}
