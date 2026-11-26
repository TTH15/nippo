"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { ParkingPlaceOption } from "@repo/core/types";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";

export function ParkingPlaceSearch({ places, showAll, onChoose }: {
  places: ParkingPlaceOption[]; showAll: boolean; onChoose: (place: ParkingPlaceOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const bounds = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const term = query.normalize("NFKC").trim().toLocaleLowerCase();
  const matches = open && (term || showAll)
    ? places.filter(place => place.name.normalize("NFKC").toLocaleLowerCase().includes(term))
    : null;

  useLayoutEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    };
    // A software keyboard can cover the bottom of a standalone iOS map.
    const box = bounds.current;
    const map = box?.parentElement;
    const viewport = window.visualViewport;
    function fitKeyboard() {
      if (box && map && viewport) {
        const overlap = map.getBoundingClientRect().bottom - (viewport.offsetTop + viewport.height);
        box.style.marginBottom = `${Math.max(0, overlap)}px`;
      }
    }
    fitKeyboard();
    document.addEventListener("pointerdown", outside, true);
    viewport?.addEventListener("resize", fitKeyboard);
    viewport?.addEventListener("scroll", fitKeyboard);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      viewport?.removeEventListener("resize", fitKeyboard);
      viewport?.removeEventListener("scroll", fitKeyboard);
      if (box) box.style.marginBottom = "";
    };
  }, [open]);

  function close() {
    setOpen(false);
    toggle.current?.focus({ preventScroll: true });
  }
  function choose(place: ParkingPlaceOption) {
    close();
    onChoose(place);
  }

  return <div ref={bounds} className="pointer-events-none absolute inset-3 flex flex-col justify-end">
    <div ref={panel} role="search" aria-label="駐車場を検索" className="flex max-h-full w-72 max-w-full flex-col items-start gap-1.5"
      onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
      onKeyDown={e => {
        if (open && e.key === "Escape" && !e.nativeEvent.isComposing) { e.preventDefault(); close(); }
      }}>
      <SmoothCollapse id={fieldId} open={open} speed="quick"
        className="pointer-events-auto order-last h-11 max-w-full shrink-0 rounded-full bg-white text-slate-900 shadow focus-within:ring-2 focus-within:ring-slate-500 [&>div:first-child]:max-w-full"
        horizontal={{ expandedWidth: 288, collapsedWidth: 44, control:
          <button ref={toggle} type="button" aria-label={open ? "駐車場名を入力" : "駐車場を検索"} aria-expanded={open} aria-controls={fieldId}
            className="absolute inset-y-0 left-0 grid w-11 place-items-center rounded-full focus-visible:outline-offset-[-3px]"
            onClick={() => {
              if (open) { input.current?.focus({ preventScroll: true }); return; }
              // Focus in the initiating tap, after the input becomes interactive.
              flushSync(() => { setQuery(""); setOpen(true); });
            }}><FontAwesomeIcon icon={faMagnifyingGlass} /></button>
        }}>
        <input ref={input} type="search" enterKeyHint="search" aria-label="駐車場名" placeholder="駐車場名" autoComplete="off"
          className="mx-11 h-11 min-w-0 flex-1 bg-transparent text-base outline-none [&::-webkit-search-cancel-button]:hidden"
          value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229 && matches?.length === 1) {
              e.preventDefault(); choose(matches[0]);
            }
          }} />
        {open && <button type="button" aria-label="検索を閉じる" onClick={close}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-full text-slate-600 focus-visible:outline-offset-[-3px]">
          <FontAwesomeIcon icon={faXmark} />
        </button>}
      </SmoothCollapse>
      {matches && <div className="pointer-events-auto min-h-0 max-h-48 w-full overflow-y-auto overscroll-contain rounded-xl bg-white text-slate-900 shadow">
        {matches.length ? <ul aria-label="検索候補" className="divide-y divide-slate-100">{matches.map(place =>
          <li key={place.id}><button type="button" className="min-h-11 w-full break-words px-4 py-2 text-left text-sm font-medium focus-visible:outline-offset-[-3px]"
            onClick={() => choose(place)}>{place.name}</button></li>)}</ul>
          : <p role="status" className="px-4 py-3 text-sm text-slate-600">該当する駐車場がありません。</p>}
      </div>}
    </div>
  </div>;
}
