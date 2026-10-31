"use client";

import { type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { disclosureTransition, instantTransition, quickDisclosureTransition } from "@/lib/ui/motion";

function CollapseContent({ children, speed, animateHeight }: { children: ReactNode; speed: "default" | "quick"; animateHeight: boolean }) {
  const present = useIsPresent();
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={animateHeight ? { height: 0, opacity: 0 } : { opacity: 0 }}
      animate={animateHeight ? { height: "auto", opacity: 1 } : { opacity: 1 }}
      exit={animateHeight ? { height: 0, opacity: 0 } : { opacity: 0 }}
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
export function SmoothCollapse({ open, children, id, labelledBy, speed = "default", animateHeight = true, horizontal, className }: {
  open: boolean;
  children: ReactNode;
  id?: string;
  labelledBy?: string;
  speed?: "default" | "quick";
  /** Heavy content below stays at one layout position while the panel fades. */
  animateHeight?: boolean;
  /** サイドバー用。内容を保持し、閉じた幅にも開閉操作を残す。 */
  horizontal?: { expandedWidth: number; collapsedWidth: number; control: ReactNode; persistentContent?: boolean };
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  if (horizontal) {
    const transition = reduceMotion ? instantTransition : speed === "quick" ? quickDisclosureTransition : disclosureTransition;
    return <motion.div initial={false} animate={{ width: open ? horizontal.expandedWidth : horizontal.collapsedWidth }} transition={transition}
      className={`relative overflow-hidden ${className ?? ""}`}>
      <motion.div id={id} role={labelledBy ? "region" : undefined} aria-labelledby={labelledBy}
        aria-hidden={!open && !horizontal.persistentContent || undefined} inert={!open && !horizontal.persistentContent || undefined} initial={false} animate={{ opacity: open || horizontal.persistentContent ? 1 : 0 }} transition={transition}
        style={{ width: horizontal.expandedWidth }} className="flex h-full min-h-0 flex-col">
        {children}
      </motion.div>
      {horizontal.control}
    </motion.div>;
  }
  return (
    <div id={id} role={labelledBy ? "region" : undefined} aria-labelledby={labelledBy} aria-hidden={!open || undefined}>
      <AnimatePresence initial={false}>
        {open && <CollapseContent key="content" speed={speed} animateHeight={animateHeight}>{children}</CollapseContent>}
      </AnimatePresence>
    </div>
  );
}
