"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGripVertical } from "@fortawesome/free-solid-svg-icons";
import { instantTransition, reorderTransition } from "@/lib/ui/motion";
import { cn } from "@/lib/ui/utils";

type Item = { id: string };
type Props<T extends Item> = {
  items: T[];
  onReorder: (items: T[]) => void;
  getLabel: (item: T) => string;
  children: (item: T, handle: ReactNode) => ReactNode;
  label: string;
  className?: string;
  itemClassName?: (item: T) => string;
};

/** 単一の縦リスト用。入力・開閉とドラッグ操作をハンドルで分離する。 */
export function SortableList<T extends Item>({ items, onReorder, getLabel, children, label, className, itemClassName }: Props<T>) {
  const helpId = useId();
  const [announcement, setAnnouncement] = useState("");
  const [active, setActive] = useState<{ id: string; keyboard: boolean } | null>(null);
  const activeRef = useRef(active);
  const originalOrder = useRef<string[]>([]);
  const currentItems = useRef(items);
  currentItems.current = items;

  const start = (id: string, keyboard: boolean) => {
    originalOrder.current = currentItems.current.map(item => item.id);
    activeRef.current = { id, keyboard };
    setActive(activeRef.current);
    const item = currentItems.current.find(item => item.id === id)!;
    setAnnouncement(`${getLabel(item)}を移動中。上下キーで移動、Spaceで確定、Escapeで取り消します。`);
  };
  const reorder = (next: T[]) => {
    if (!activeRef.current) return;
    currentItems.current = next;
    onReorder(next);
    const index = next.findIndex(item => item.id === activeRef.current?.id);
    if (index >= 0) setAnnouncement(`${getLabel(next[index])}、${next.length}項目中${index + 1}番目。`);
  };
  const finish = (cancel = false) => {
    const moving = activeRef.current;
    if (!moving) return;
    if (cancel) {
      // 操作中に項目の内容が更新されても、復元するのは順序だけ。
      const rank = new Map(originalOrder.current.map((id, index) => [id, index]));
      const restored = [...currentItems.current].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
      currentItems.current = restored;
      onReorder(restored);
    }
    const index = currentItems.current.findIndex(item => item.id === moving.id);
    setAnnouncement(cancel ? "並べ替えを取り消しました。" : `並べ替えを確定しました。${index + 1}番目です。`);
    activeRef.current = null;
    setActive(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (!activeRef.current) start(id, true);
      else if (activeRef.current.id === id) finish();
    } else if (activeRef.current?.id === id && activeRef.current.keyboard) {
      if (event.key === "Escape") { event.preventDefault(); finish(true); }
      else if (event.key === "Tab") finish();
      else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = [...currentItems.current];
        const index = next.findIndex(item => item.id === id);
        const target = event.key === "Home" ? 0 : event.key === "End" ? next.length - 1 : index + (event.key === "ArrowUp" ? -1 : 1);
        if (target < 0 || target >= next.length) return;
        next.splice(target, 0, ...next.splice(index, 1));
        reorder(next);
      }
    }
  };

  return <>
    <p id={helpId} className="sr-only">ハンドルをドラッグして並べ替え。キーボードはSpaceかEnterで開始、上下キーで移動、SpaceかEnterで確定、Escapeで取り消し。</p>
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
    <Reorder.Group axis="y" values={items.map(item => item.id)} aria-label={label} className={cn("space-y-3", className)}
      onReorder={ids => {
        const byId = new Map(currentItems.current.map(item => [item.id, item]));
        if (ids.length === byId.size && ids.every(id => byId.has(id))) reorder(ids.map(id => byId.get(id)!));
      }}>
      {items.map(item => <SortableItem key={item.id} id={item.id} label={getLabel(item)} helpId={helpId}
        active={active?.id === item.id} keyboard={active?.id === item.id && active.keyboard}
        disabled={items.length < 2 || (!!active && active.id !== item.id)}
        className={itemClassName?.(item)} onStart={() => start(item.id, false)} onFinish={finish}
        onKeyDown={event => onKeyDown(event, item.id)}>
        {handle => children(item, handle)}
      </SortableItem>)}
    </Reorder.Group>
  </>;
}

function SortableItem({ id, label, helpId, active, keyboard, disabled, className, onStart, onFinish, onKeyDown, children }: {
  id: string; label: string; helpId: string; active: boolean; keyboard: boolean; disabled: boolean;
  className?: string; onStart: () => void; onFinish: (cancel?: boolean) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  children: (handle: ReactNode) => ReactNode;
}) {
  const controls = useDragControls();
  const reduceMotion = useReducedMotion();
  const handleRef = useRef<HTMLButtonElement>(null);
  return <Reorder.Item value={id} dragListener={false} dragControls={controls} layout="position"
    dragMomentum={false} transition={reduceMotion ? instantTransition : reorderTransition}
    dragTransition={{ bounceStiffness: 420, bounceDamping: 32, ...(reduceMotion ? { timeConstant: 0, restDelta: 100000 } : {}) }}
    whileDrag={reduceMotion ? undefined : { scale: 1.012, boxShadow: "0 14px 30px -12px rgb(15 23 42 / 0.28)" }}
    onDragStart={() => { handleRef.current?.focus({ preventScroll: true }); onStart(); }}
    onDragEnd={() => onFinish()}
    onKeyDown={event => {
      if (active && !keyboard && event.key === "Escape") { event.preventDefault(); controls.stop(); onFinish(true); }
    }}
    className={cn("relative rounded-xl border border-slate-200 bg-white", className, active && "border-amber-400 ring-2 ring-amber-100")}
    style={{ position: "relative" }}>
    {children(<button ref={handleRef} type="button" aria-label={`${label}を並べ替え`} aria-describedby={helpId}
      aria-pressed={active} disabled={disabled} title="ドラッグして並べ替え"
      onPointerDown={event => { if (!disabled && !keyboard && event.isPrimary && event.button === 0) controls.start(event); }}
      onPointerCancel={() => { controls.stop(); onFinish(true); }}
      onKeyDown={onKeyDown} onBlur={() => { if (keyboard) onFinish(); }}
      className={cn("flex size-11 shrink-0 touch-none select-none items-center justify-center rounded-lg text-slate-400 outline-none transition-colors hover:bg-amber-50 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-default disabled:opacity-30", active ? "cursor-grabbing bg-amber-50 text-slate-800" : "cursor-grab")}
    ><FontAwesomeIcon icon={faGripVertical} className="size-4"/></button>)}
  </Reorder.Item>;
}
