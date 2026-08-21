"use client";

import { useLayoutEffect, useRef, useState, type Ref } from "react";
import { InvoiceSheet, type InvoiceIssuerDisplay } from "./InvoiceSheet";
import type { EditorState } from "./editorModel";
import { collectPageUnits, computePageIndices, PAGE_CONTENT_HEIGHT_PX } from "./paginate";

function sameIndices(a: Map<string, number>, b: Map<string, number>) {
  if (a.size !== b.size) return false;
  for (const [id, page] of a) if (b.get(id) !== page) return false;
  return true;
}

const EMPTY_INDICES: Map<string, number> = new Map();

/**
 * 請求書シートに「実際に印刷されるページ境界」をライブで可視化するラッパー。
 * プレビュー画面と編集画面の区別をなくすため、readOnly の両モードで共通に使う
 * （InvoiceSheetEditor / [id]/preview/page.tsx の双方から利用）。
 *
 * 常設の非表示・計測専用クローン（printRoot=false, 素の連続レイアウト）を1つ持ち、
 * そこだけを計測してアトミックブロックごとのページ番号を求める。実際に表示・編集
 * される InvoiceSheet（pageIndexOf 付き）はその結果でページコンテナへグルーピング
 * して描画し、そちらがそのまま印刷対象になる（画面と印刷が同じ計算結果を共有する）。
 */
export function PaginatedInvoiceSheet({
  state,
  readOnly = false,
  onChange,
  sheetRef,
  className,
  issuer,
}: {
  state: EditorState;
  readOnly?: boolean;
  onChange?: (next: EditorState) => void;
  sheetRef?: Ref<HTMLDivElement>;
  className?: string;
  issuer?: InvoiceIssuerDisplay;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [pageIndices, setPageIndices] = useState<Map<string, number>>(EMPTY_INDICES);

  // レイアウトに影響する項目のみを依存にする（グリッドの選択状態などは対象外）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const units = collectPageUnits(root);
    const next = computePageIndices(units, PAGE_CONTENT_HEIGHT_PX);
    setPageIndices((prev) => (sameIndices(prev, next) ? prev : next));
  }, [
    state.kind,
    state.main,
    state.deduct,
    state.blockBreaks,
    state.taxEnabled,
    state.taxRatePercent,
    state.loanRepay,
    state.extraOutsourcingExclusive,
    state.extraOutsourcingInclusive,
    state.displayBasis,
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

  const pageIndexOf = (unitId: string) => pageIndices.get(unitId) ?? 0;

  return (
    <>
      {/* 計測専用の隠しコピー（素の連続レイアウト）。印刷対象ではない。
          interactive=false で data-cell 等のグリッドAPIを出さない
          （実体と同じ data-cell を持つと document.querySelector によるフォーカス移動が
          こちらの見えない・操作できないクローンを誤って拾ってしまうため）。
          readOnly は常に true で計測する。編集画面(readOnly=false)では
          breakToggle 等の hide-print UI（画面には表示され印刷時のみ display:none）が
          通常フローに高さを持って乗るため、編集中の見た目のまま計測すると
          実際の印刷より過大な高さになり、本来1ページに収まる内容でも
          不要な改ページが入ってしまう。ページ割りは常に「印刷される見た目」で判定する。 */}
      <div style={{ position: "absolute", left: 0, top: 0, zIndex: -1, visibility: "hidden", pointerEvents: "none" }} aria-hidden>
        <InvoiceSheet state={state} readOnly printRoot={false} interactive={false} sheetRef={measureRef} issuer={issuer} />
      </div>
      {/* 実際に表示・編集され、そのまま印刷対象になる実体。 */}
      <InvoiceSheet
        state={state}
        readOnly={readOnly}
        onChange={onChange}
        sheetRef={sheetRef}
        className={className}
        pageIndexOf={pageIndexOf}
        issuer={issuer}
      />
    </>
  );
}
