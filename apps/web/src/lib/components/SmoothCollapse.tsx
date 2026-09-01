"use client";

import { type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { disclosureTransition, instantTransition, quickDisclosureTransition } from "@/lib/ui/motion";

function CollapseContent({ children, speed }: { children: ReactNode; speed: "default" | "quick" }) {
  const present = useIsPresent();
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={reduceMotion ? instantTransition : speed === "quick" ? quickDisclosureTransition : disclosureTransition}
      className="overflow-hidden"
      inert={!present}
      aria-hidden={!present || undefined}
    >
      {children}
    </motion.div>
  );
}

/** トリガーは呼び出し側のbutton。aria-expanded/aria-controlsを紐付ける。 */
export function SmoothCollapse({ open, children, id, labelledBy, speed = "default" }: {
  open: boolean;
  children: ReactNode;
  id?: string;
  labelledBy?: string;
  speed?: "default" | "quick";
}) {
  return (
    <div id={id} role={labelledBy ? "region" : undefined} aria-labelledby={labelledBy} aria-hidden={!open || undefined}>
      <AnimatePresence initial={false}>
        {open && <CollapseContent key="content" speed={speed}>{children}</CollapseContent>}
      </AnimatePresence>
    </div>
  );
}
