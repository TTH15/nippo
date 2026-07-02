"use client";

import { useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { InvoiceSheet } from "./InvoiceSheet";
import type { EditorState } from "./editorModel";
import { collectPageUnits, computeBreakUnitIds, PAGE_CONTENT_HEIGHT_PX } from "./paginate";

function mergeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as { current: T | null }).current = node;
    }
  };
}

function sameIds(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

const EMPTY_IDS: Set<string> = new Set();

/**
 * 請求書シートに「実際に印刷される改ページ位置」をライブで可視化するラッパー。
 * プレビュー画面と編集画面の区別をなくすため、readOnly の両モードで共通に使う
 * （InvoiceSheetEditor / [id]/preview/page.tsx の双方から利用）。
 *
 * 常設の非表示・計測専用クローン（printRoot=false）を1つ持ち、そこだけを計測して
 * 改ページが必要なユニットの id 集合を求める。実際に表示・編集される InvoiceSheet 自体は
 * 一切自己計測しない（継ぎ目バンド挿入→再計測のカスケードを避けるため）。
 */
export function PaginatedInvoiceSheet({
  state,
  readOnly = false,
  onChange,
  sheetRef,
  className,
}: {
  state: EditorState;
  readOnly?: boolean;
  onChange?: (next: EditorState) => void;
  sheetRef?: Ref<HTMLDivElement>;
  className?: string;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [breakBeforeIds, setBreakBeforeIds] = useState<Set<string>>(EMPTY_IDS);
  const measureCallbackRef = useMemo(() => mergeRefs(measureRef), []);

  // レイアウトに影響する項目のみを依存にする（グリッドの選択状態などは対象外）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const units = collectPageUnits(root);
    const next = computeBreakUnitIds(units, PAGE_CONTENT_HEIGHT_PX);
    setBreakBeforeIds((prev) => (sameIds(prev, next) ? prev : next));
  }, [
    state.kind,
    state.main,
    state.deduct,
    state.blockBreaks,
    state.taxEnabled,
    state.taxRatePercent,
    state.loanRepay,
    state.extraOutsourcing,
    state.toName,
    state.toAddrHtml,
    state.fromName,
    state.fromAddrHtml,
    state.honorific,
    state.period,
    state.invoiceNo,
    state.fromTel,
    state.fromReg,
    state.dueDate,
    state.bankName,
    state.bankNo,
    state.bankHolder,
  ]);

  return (
    <>
      {/* 計測専用の隠しコピー。編集中と同じ readOnly で計測し、見た目・折り返しのズレを防ぐ。 */}
      <div style={{ position: "absolute", left: 0, top: 0, zIndex: -1, visibility: "hidden", pointerEvents: "none" }} aria-hidden>
        <InvoiceSheet state={state} readOnly={readOnly} printRoot={false} sheetRef={measureCallbackRef} />
      </div>
      <InvoiceSheet
        state={state}
        readOnly={readOnly}
        onChange={onChange}
        sheetRef={sheetRef}
        className={className}
        breakBeforeIds={breakBeforeIds}
      />
    </>
  );
}
