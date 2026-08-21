import {
  Fragment,
  type Ref,
  type ReactNode,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGripVertical, faPlus, faTrashCan, faScissors } from "@fortawesome/free-solid-svg-icons";
import { computeInvoiceTotals, resolveRowPrice } from "@repo/core/logic/reward";
import type { InvoiceTotals } from "@repo/core/types";
import { cn } from "@/lib/ui/utils";
import { getInvoiceIssuer } from "@/config/companies";
import { INVOICE_KIND_CONFIG, type SummaryRowDef } from "./invoiceKinds";
import {
  type EditorState,
  type EditorLine,
  type TaxBasis,
  emptyLine,
  docDataFromEditor,
  formatDateJa,
  currentExtraOutsourcing,
} from "./editorModel";
import {
  COL_COUNT,
  parseClipboardGrid,
  applyPaste,
  fillColumn,
  insertLineAt,
  removeLineAt,
  moveLine,
} from "./lineGrid";

type Section = "main" | "deduct";

// 画面上でページの継ぎ目を示すグレーの余白（印刷には出さない。UI上の見た目だけの値で
// paginate.ts の改ページ判定には一切影響しない）。
const PAGE_GAP_UI_PX = 28;
// 各 .invoice-page の内側余白。paginate.ts の TOP_PAD_PX(5mm) / BOTTOM_PAD_PX(8mm) と
// 対応関係にあるので、変更する場合は両方合わせること。
const PAGE_PADDING = "5mm 14mm 8mm 14mm";

/** 改ページ計算の1ユニット（アトミックブロック）。 */
type Block = {
  id: string;
  forceBreak: boolean;
  node: ReactNode;
};

/** 明細テーブルのスプレッドシート編集API（!readOnly のときだけ供給）。 */
type GridApi = {
  isFillTarget: (section: Section, row: number, col: number) => boolean;
  isActive: (section: Section, row: number, col: number) => boolean;
  cellProps: (
    section: Section,
    row: number,
    col: number,
  ) => {
    dataCell: string;
    onFocus: () => void;
    onBlur: () => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
    onPaste: (e: ReactClipboardEvent<HTMLInputElement>) => void;
  };
  fillHandle: (section: Section, row: number, col: number) => ReactNode;
  rowControls: (section: Section, row: number, hasBreak: boolean) => ReactNode;
  /** 明細が0行のテーブルに最初の1行を追加する（行が無いとホバー操作の起点が無いため）。 */
  addFirstLine: (section: Section) => void;
  rowProps: (
    section: Section,
    row: number,
  ) => {
    onMouseEnter: () => void;
    onDragOver: (e: ReactDragEvent) => void;
    onDrop: (e: ReactDragEvent) => void;
  };
};

// 御請求書（A4帳票）。編集とプレビューを同一にした WYSIWYG コンポーネント。
// readOnly=false のとき、帳票上のテキスト・明細セルを直接インライン編集する（Word風）。
// 計算は @repo/core に集約。種別（売上/受領）ごとの設定で色・項目を出し分ける。
//
// 改ページはブラウザのネイティブな印刷改ページを予測するのではなく、
// PaginatedInvoiceSheet が計測して求めた pageIndexOf を使い、こちら側で
// 明示的にページ（.invoice-page）へグルーピングして描画する（画面と印刷を完全一致させる）。
// pageIndexOf が無いとき（計測用の非表示クローン）は素の連続レイアウトで描画する。
//
// 注意: 入力欄を持つサブコンポーネント（T）は必ずモジュールレベルに定義する。
// 関数内で定義すると毎レンダーで別物と見なされ再マウント→フォーカス喪失（IME/複数桁入力不可）になる。

const jpy = (n: number) => Number(n || 0).toLocaleString("ja-JP");
const num = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const priceDisplay = (v: unknown) =>
  Number(num(v)).toLocaleString("ja-JP", { maximumFractionDigits: 2 });

/**
 * 編集可能な数量/単価セルの表示用フォーマット。
 * フォーカス中（入力中）は生の文字列のまま返す（カンマ挿入でカーソル位置がずれるのを防ぐ）。
 * フォーカスが外れているときだけ3桁カンマ区切りで見やすく表示する。
 */
function editableNumDisplay(raw: string, isActive: boolean): string {
  if (isActive) return raw;
  if (!raw) return raw;
  const n = num(raw);
  if (!Number.isFinite(n) || n === 0) return raw;
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

function resolveSummaryValue(ref: SummaryRowDef["value"], totals: InvoiceTotals, st: EditorState): number {
  if (ref.kind === "total") return totals[ref.key];
  return ref.field === "loanRepay" ? num(st.loanRepay) : currentExtraOutsourcing(st);
}

/** インライン編集テキスト（readOnly のときは素のテキスト）。 */
/**
 * 住所の入力欄。**内容に合わせて高さが伸びる**。
 * 固定 rows={2} だと3行以上の住所が編集画面で切れ、そのまま印刷にも出なかった
 * （2026-08-18 指摘）。読み取り表示は div なので元から問題ない。
 */
function AddressArea({
  html,
  onChange,
  className,
}: {
  html: string;
  onChange: (html: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = html.replace(/<br\s*\/?>/gi, "\n");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={text}
      placeholder={"〒\n（住所）"}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, "<br/>"))}
      className={cn("w-full bg-transparent outline-none focus:bg-blue-50 rounded-sm resize-none overflow-hidden", className)}
    />
  );
}

/**
 * 「電話：」「登録番号：」のような値つきの1行。
 * ★空のときはラベルごと消す。読み取り表示では描画せず、編集中は入力できるよう
 *   画面には残したまま `hide-print` で印刷からだけ落とす（2026-08-18 指摘）。
 */
function LabeledLine({
  readOnly,
  label,
  value,
  onChange,
}: {
  readOnly: boolean;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  if (readOnly) return value ? <div>{`${label}${value}`}</div> : null;
  return (
    <div className={cn("flex items-baseline", !value && "hide-print")}>
      <span className="shrink-0 whitespace-nowrap">{label}</span>
      <T readOnly={false} value={value} onChange={onChange} />
    </div>
  );
}

function T({
  readOnly,
  value,
  onChange,
  placeholder,
  className,
  align = "left",
  bold,
  inputMode,
  dataCell,
  onFocus,
  onBlur,
  onKeyDown,
  onPaste,
}: {
  readOnly: boolean;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  className?: string;
  align?: "left" | "right" | "center";
  bold?: boolean;
  inputMode?: "decimal" | "numeric";
  dataCell?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPaste?: (e: ReactClipboardEvent<HTMLInputElement>) => void;
}) {
  if (readOnly) return <span className={cn(bold && "font-bold", className)}>{value}</span>;
  return (
    <input
      value={value}
      placeholder={placeholder}
      inputMode={inputMode}
      data-cell={dataCell}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn("bg-transparent outline-none w-full", bold && "font-bold", className)}
      style={{ textAlign: align }}
    />
  );
}

/**
 * 明細テーブル（請求/報酬・お支払い/控除）のアトミックブロックを組み立てる。
 * 通常は1ブロック（1つの<table>）。行のいずれかに手動の pageBreakBefore が
 * 立っている場合だけ、その行の直前で<table>を複数に分割する（自動の高さ計算では
 * 絶対に分割しない＝入力中に行が別テーブルへ再親化されてフォーカス/IMEが
 * 切れる心配がない。分割されるのはユーザーがハサミボタンを押した瞬間だけ）。
 */
function buildLineTableBlocks({
  readOnly,
  section,
  lines,
  title,
  color,
  soft,
  subtotal,
  tax,
  gross,
  subtotalLabel,
  taxLabel,
  grossLabel,
  displayBasis,
  styleFirst,
  sectionForceBreak,
  breakToggle,
  setLine,
  grid,
  keepLastWithNext,
}: {
  readOnly: boolean;
  section: Section;
  lines: EditorLine[];
  title: string;
  color: string;
  soft: string;
  subtotal: number;
  tax: number;
  gross: number;
  subtotalLabel: string;
  taxLabel: string;
  grossLabel: string;
  displayBasis: TaxBasis;
  styleFirst?: CSSProperties;
  sectionForceBreak: boolean;
  breakToggle: ReactNode;
  setLine: (section: Section, i: number, patch: Partial<EditorLine>) => void;
  grid?: GridApi;
  /** true の場合、この明細テーブルの最終セグメントを直後のブロック（振込先等）と同じページに保つ。 */
  keepLastWithNext?: boolean;
}): Block[] {
  const splitPoints = lines
    .map((ln, i) => i)
    .filter((i) => i > 0 && lines[i].pageBreakBefore);
  const segments: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const sp of splitPoints) {
    segments.push({ start: cursor, end: sp });
    cursor = sp;
  }
  segments.push({ start: cursor, end: lines.length });

  return segments.map((seg, segIdx) => {
    const isFirst = segIdx === 0;
    const isLast = segIdx === segments.length - 1;
    const segLines = lines.slice(seg.start, seg.end);
    const id = segments.length === 1 ? `${section}-table` : `${section}-table-${segIdx}`;
    const forceBreak = isFirst ? sectionForceBreak : true;
    const keepWithNext = isLast && keepLastWithNext;

    const node = (
      <div data-page-unit data-unit-id={id} data-force-break={forceBreak ? "true" : undefined} data-keep-with-next={keepWithNext ? "true" : undefined} className="relative" style={isFirst ? styleFirst : undefined}>
        {isFirst ? breakToggle : null}
        <table className="w-full border-collapse text-[11.5px]" style={{ border: `6px solid ${color}` }}>
          <thead>
            <tr>
              <th colSpan={5} className="bg-white py-[4px] px-2 text-center text-[14px] font-black tracking-[5px]" style={{ color, border: `2px solid ${color}` }}>
                {title}
              </th>
            </tr>
            <tr className="text-white font-semibold">
              <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "40%" }}>摘要</th>
              <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "11%" }}>数量</th>
              <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "9%" }}>単位</th>
              <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "18%" }}>{displayBasis === "inclusive" ? "税込単価（円）" : "税抜単価（円）"}</th>
              <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "22%" }}>{displayBasis === "inclusive" ? "税込合計（円）" : "税抜合計（円）"}</th>
            </tr>
          </thead>
          <tbody>
            {segLines.length === 0 && grid ? (
              <tr className="hide-print">
                <td colSpan={5} className="py-[6px] text-center bg-white">
                  <button
                    type="button"
                    onClick={() => grid.addFirstLine(section)}
                    className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-blue-600"
                  >
                    <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
                    行を追加
                  </button>
                </td>
              </tr>
            ) : null}
            {segLines.map((ln, localI) => {
              const i = seg.start + localI;
              const cellCls = (col: number, extra?: string) =>
                cn(
                  "py-[2.5px] px-2 bg-white relative",
                  extra,
                  grid?.isFillTarget(section, i, col) && "bg-blue-50",
                  grid?.isActive(section, i, col) && "ring-2 ring-inset ring-blue-500",
                );
              return (
                <tr key={i} className="group" {...(grid ? grid.rowProps(section, i) : {})}>
                  <td className={cellCls(0, "leading-[1.3]")} style={{ border: `1px solid ${color}` }}>
                    <T readOnly={readOnly} value={ln.title} placeholder="摘要" onChange={(v) => setLine(section, i, { title: v })} {...(grid ? grid.cellProps(section, i, 0) : {})} />
                    {grid ? grid.fillHandle(section, i, 0) : null}
                  </td>
                  <td className={cellCls(1)} style={{ border: `1px solid ${color}` }}>
                    <T readOnly={readOnly} value={readOnly ? (ln.qty ? jpy(num(ln.qty)) : "") : editableNumDisplay(ln.qty, grid?.isActive(section, i, 1) ?? false)} align="right" placeholder="0" inputMode="decimal" onChange={(v) => setLine(section, i, { qty: v })} {...(grid ? grid.cellProps(section, i, 1) : {})} />
                    {grid ? grid.fillHandle(section, i, 1) : null}
                  </td>
                  <td className={cellCls(2)} style={{ border: `1px solid ${color}` }}>
                    <T readOnly={readOnly} value={ln.unit} align="center" placeholder="件" onChange={(v) => setLine(section, i, { unit: v })} {...(grid ? grid.cellProps(section, i, 2) : {})} />
                    {grid ? grid.fillHandle(section, i, 2) : null}
                  </td>
                  <td className={cellCls(3)} style={{ border: `1px solid ${color}` }}>
                    <div className="flex items-center justify-end gap-1">
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() =>
                            setLine(section, i, { priceBasis: ln.priceBasis === "inclusive" ? "exclusive" : "inclusive" })
                          }
                          title={
                            ln.priceBasis === "inclusive"
                              ? "この行は税込で入力（クリックで税抜入力に切替。数値はそのまま、基準だけ変わる）"
                              : "この行は税抜で入力（クリックで税込入力に切替。数値はそのまま、基準だけ変わる）"
                          }
                          className={cn(
                            "hide-print shrink-0 rounded px-1 text-[9px] font-bold leading-[14px]",
                            ln.priceBasis === "inclusive" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500",
                          )}
                        >
                          {ln.priceBasis === "inclusive" ? "込" : "抜"}
                        </button>
                      )}
                      <T
                        readOnly={readOnly}
                        value={
                          readOnly
                            ? resolveRowPrice(ln, displayBasis)
                              ? priceDisplay(resolveRowPrice(ln, displayBasis))
                              : ""
                            : editableNumDisplay(ln.price, grid?.isActive(section, i, 3) ?? false)
                        }
                        align="right"
                        placeholder="0"
                        inputMode="decimal"
                        onChange={(v) => setLine(section, i, { price: v })}
                        {...(grid ? grid.cellProps(section, i, 3) : {})}
                      />
                    </div>
                    {grid ? grid.fillHandle(section, i, 3) : null}
                  </td>
                  <td className={cn("py-[2.5px] px-2 text-right bg-white", grid && "relative")} style={{ border: `1px solid ${color}` }}>
                    {jpy(Math.round(num(ln.qty) * resolveRowPrice(ln, displayBasis)))}
                    {grid ? grid.rowControls(section, i, Boolean(ln.pageBreakBefore)) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {isLast ? (
            <tfoot>
              <tr>
                <td colSpan={4} className="py-[2.5px] px-2 text-right font-semibold" style={{ border: `1px solid ${color}`, backgroundColor: soft }}>{subtotalLabel}</td>
                <td className="py-[2.5px] px-2 text-right bg-white" style={{ border: `1px solid ${color}` }}>{jpy(subtotal)}</td>
              </tr>
              {taxLabel ? (
                <tr>
                  <td colSpan={4} className="py-[2.5px] px-2 text-right font-semibold" style={{ border: `1px solid ${color}`, backgroundColor: soft }}>{taxLabel}</td>
                  <td className="py-[2.5px] px-2 text-right bg-white" style={{ border: `1px solid ${color}` }}>{jpy(tax)}</td>
                </tr>
              ) : null}
              <tr className="font-bold text-white">
                <td colSpan={4} className="py-[2.5px] px-2 text-right" style={{ border: `1px solid ${color}`, backgroundColor: color }}>{grossLabel}</td>
                <td className="py-[2.5px] px-2 text-right" style={{ border: `1px solid ${color}`, backgroundColor: color }}>{jpy(gross)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    );
    return { id, forceBreak, node };
  });
}

export function InvoiceSheet({
  state,
  readOnly = false,
  onChange,
  sheetRef,
  className,
  printRoot = true,
  pageIndexOf,
  interactive = true,
}: {
  state: EditorState;
  readOnly?: boolean;
  onChange?: (next: EditorState) => void;
  sheetRef?: Ref<HTMLDivElement>;
  className?: string;
  /** false の場合 "invoice-print-root" クラスを付けない（画面専用の計測用クローンが印刷CSSに拾われないようにする）。既定 true。 */
  printRoot?: boolean;
  /** 各アトミックブロックの id → ページ番号。指定時はページごとに .invoice-page へグルーピングして描画する。未指定時は素の連続レイアウト（計測用）。 */
  pageIndexOf?: (unitId: string) => number;
  /** false の場合、readOnly=false でも data-cell やホバー操作などのグリッドAPIを供給しない
   * （画面専用の計測用クローンが、実体と同じ data-cell を持って document.querySelector を
   * 誤誘導しないようにするため。入力欄自体の見た目/サイズは readOnly の値どおりに保つ）。既定 true。 */
  interactive?: boolean;
}) {
  const st = state;
  const config = INVOICE_KIND_CONFIG[st.kind] ?? INVOICE_KIND_CONFIG.outgoing;
  const C = config.theme;
  const doc = docDataFromEditor(st);
  const invoiceIssuer = getInvoiceIssuer();
  const shouldShowIssuerStamp = Boolean(
    invoiceIssuer.stampPath && st.fromName.trim() === invoiceIssuer.name.trim(),
  );
  const totals = computeInvoiceTotals({
    main: doc.main,
    deduct: doc.deduct,
    taxEnabled: st.taxEnabled,
    taxRatePercent: num(st.taxRatePercent),
    loanRepay: num(st.loanRepay),
    extraOutsourcing: currentExtraOutsourcing(st),
    displayBasis: st.displayBasis,
  });
  const ratePct = Math.round(num(st.taxRatePercent));
  // 「（税込）」表記には必ず税率を添える（税OFFなら0%）。
  const taxNote = st.taxEnabled ? `${ratePct}%` : "0%";
  const withTaxNote = (label: string) => label.replace("（税込）", `（税込 ${taxNote}）`);

  const set = (patch: Partial<EditorState>) => onChange?.({ ...st, ...patch });
  const setLine = (section: Section, i: number, patch: Partial<EditorLine>) =>
    set({ [section]: st[section].map((l, idx) => (idx === i ? { ...l, ...patch } : l)) } as Partial<EditorState>);

  // ── スプレッドシート編集（選択/フィル/並べ替え）。状態は描画用＋最新参照用 ref の二重持ち ──
  const [active, setActive] = useState<{ section: Section; row: number; col: number } | null>(null);
  const [fill, setFill] = useState<{ section: Section; col: number; fromRow: number; toRow: number } | null>(null);
  // サマリー欄（借入返済/追加外注請求分・売上追加分）のフォーカス中フィールド。
  // フォーカス外れ時だけカンマ区切り表示にする（入力中のカーソル位置ずれを防ぐ）。
  const [summaryFocus, setSummaryFocus] = useState<"loanRepay" | "extraOutsourcing" | null>(null);
  const stRef = useRef(st);
  stRef.current = st;
  const fillRef = useRef(fill);
  const dragRef = useRef<{ section: Section; row: number } | null>(null);

  const setLines = (section: Section, next: EditorLine[]) =>
    onChange?.({ ...stRef.current, [section]: next });

  const focusCell = (section: Section, row: number, col: number) => {
    const el = document.querySelector(`[data-cell="${section}|${row}|${col}"]`) as HTMLInputElement | null;
    if (el) {
      el.focus();
      el.select();
    }
  };

  const grid: GridApi | undefined = readOnly || !interactive
    ? undefined
    : {
        isFillTarget: (section, row, col) => {
          if (!fill || fill.section !== section || fill.col !== col) return false;
          const lo = Math.min(fill.fromRow, fill.toRow);
          const hi = Math.max(fill.fromRow, fill.toRow);
          return row >= lo && row <= hi;
        },
        isActive: (section, row, col) => !!active && active.section === section && active.row === row && active.col === col,
        cellProps: (section, row, col) => ({
          dataCell: `${section}|${row}|${col}`,
          onFocus: () => setActive({ section, row, col }),
          // フォーカスが外れたらアクティブ枠/フィルハンドルを消す。
          // フィルハンドルの mousedown は preventDefault でフォーカスを保持するため drag は維持される。
          onBlur: () => setActive((cur) => (cur && cur.section === section && cur.row === row && cur.col === col ? null : cur)),
          onKeyDown: (e) => {
            const lines = stRef.current[section];
            if (e.key === "Enter") {
              if (e.nativeEvent.isComposing) return;
              e.preventDefault();
              if (row + 1 >= lines.length) setLines(section, [...lines.map((l) => ({ ...l })), emptyLine()]);
              setTimeout(() => focusCell(section, row + 1, col), 0);
            } else if (e.key === "Tab") {
              e.preventDefault();
              const dir = e.shiftKey ? -1 : 1;
              let nc = col + dir;
              let nr = row;
              if (nc >= COL_COUNT) {
                nc = 0;
                nr = row + 1;
              }
              if (nc < 0) {
                nc = COL_COUNT - 1;
                nr = row - 1;
              }
              if (nr < 0) return;
              if (nr >= lines.length && dir > 0) setLines(section, [...lines.map((l) => ({ ...l })), emptyLine()]);
              setTimeout(() => focusCell(section, nr, nc), 0);
            } else if (e.key === "ArrowDown") {
              if (row + 1 < lines.length) {
                e.preventDefault();
                setTimeout(() => focusCell(section, row + 1, col), 0);
              }
            } else if (e.key === "ArrowUp") {
              if (row > 0) {
                e.preventDefault();
                setTimeout(() => focusCell(section, row - 1, col), 0);
              }
            } else if (e.key === "ArrowRight") {
              // 上下キーと同様、常に右のセルへ移動する。
              if (col + 1 < COL_COUNT) {
                e.preventDefault();
                setTimeout(() => focusCell(section, row, col + 1), 0);
              }
            } else if (e.key === "ArrowLeft") {
              // 上下キーと同様、常に左のセルへ移動する。
              if (col > 0) {
                e.preventDefault();
                setTimeout(() => focusCell(section, row, col - 1), 0);
              }
            }
          },
          onPaste: (e) => {
            const text = e.clipboardData?.getData("text") ?? "";
            // 単一値（タブ/改行なし）は通常の貼り付けに任せる
            if (!text.includes("\t") && !text.includes("\n")) return;
            e.preventDefault();
            setLines(section, applyPaste(stRef.current[section], row, col, parseClipboardGrid(text)));
          },
        }),
        fillHandle: (section, row, col) => {
          if (!active || active.section !== section || active.row !== row || active.col !== col) return null;
          return (
            <span
              role="presentation"
              title="ドラッグで下の行へコピー"
              onMouseDown={(e) => {
                e.preventDefault();
                const f = { section, col, fromRow: row, toRow: row };
                fillRef.current = f;
                setFill(f);
                const onUp = () => {
                  const cur = fillRef.current;
                  if (cur) setLines(cur.section, fillColumn(stRef.current[cur.section], cur.col, cur.fromRow, cur.toRow));
                  fillRef.current = null;
                  setFill(null);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mouseup", onUp);
              }}
              className="hide-print absolute bottom-[-3px] right-[-3px] z-10 h-2 w-2 cursor-crosshair rounded-[1px] bg-blue-600 ring-1 ring-white"
            />
          );
        },
        // 行操作は帳票の外（右マージン）にホバー時だけ表示。テーブル列は増やさず
        // 編集と印刷のレイアウトを一致させる（hide-print）。
        rowControls: (section, row, hasBreak) => (
          <div className="hide-print absolute inset-y-0 right-[-4.8rem] z-10 flex items-center gap-2 pl-2 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
            <span
              draggable
              onDragStart={(e) => {
                dragRef.current = { section, row };
                e.dataTransfer.effectAllowed = "move";
              }}
              title="ドラッグで並べ替え"
              className="cursor-grab hover:text-slate-500"
            >
              <FontAwesomeIcon icon={faGripVertical} className="h-3 w-3" />
            </span>
            <button type="button" onClick={() => setLines(section, insertLineAt(stRef.current[section], row + 1))} title="下に行を追加" className="hover:text-slate-600">
              <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() =>
                setLines(
                  section,
                  stRef.current[section].map((l, idx) => (idx === row ? { ...l, pageBreakBefore: !l.pageBreakBefore } : l)),
                )
              }
              title={hasBreak ? "この行の前の改ページを解除" : "この行の前で改ページ"}
              className={cn("hover:text-blue-600", hasBreak && "text-blue-600")}
            >
              <FontAwesomeIcon icon={faScissors} className="h-3 w-3" />
            </button>
            <button type="button" onClick={() => setLines(section, removeLineAt(stRef.current[section], row))} title="行を削除" className="hover:text-red-500">
              <FontAwesomeIcon icon={faTrashCan} className="h-3 w-3" />
            </button>
          </div>
        ),
        addFirstLine: (section) => setLines(section, insertLineAt(stRef.current[section], 0)),
        rowProps: (section, row) => ({
          onMouseEnter: () => {
            const cur = fillRef.current;
            if (cur && cur.section === section) {
              const nf = { ...cur, toRow: row };
              fillRef.current = nf;
              setFill(nf);
            }
          },
          onDragOver: (e) => {
            if (dragRef.current && dragRef.current.section === section) e.preventDefault();
          },
          onDrop: (e) => {
            const d = dragRef.current;
            if (d && d.section === section) {
              e.preventDefault();
              setLines(section, moveLine(stRef.current[section], d.row, row));
              dragRef.current = null;
            }
          },
        }),
      };

  // ブロック境界の手動改ページ切替ボタン（hide-print）。ページ分割そのものは
  // 呼び出し側で blockBreaks を forceBreak として Block に載せるだけで実現する。
  const breakToggle = (id: string): ReactNode => {
    if (readOnly) return null;
    const active = st.blockBreaks.includes(id);
    const toggle = () =>
      set({ blockBreaks: active ? st.blockBreaks.filter((x) => x !== id) : [...st.blockBreaks, id] });
    return (
      <div className="hide-print group/brk flex h-6 items-center justify-center">
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-[10px] font-medium transition",
            active
              ? "border-blue-300 bg-blue-50 text-blue-600"
              : "border-slate-200 bg-white text-slate-400 opacity-0 group-hover/brk:opacity-100 hover:border-blue-300 hover:text-blue-600",
          )}
        >
          <FontAwesomeIcon icon={faScissors} className="h-2.5 w-2.5" />
          {active ? "改ページ（解除）" : "改ページ"}
        </button>
      </div>
    );
  };

  // ── アトミックブロックの組み立て ──
  const blocks: Block[] = [
    {
      id: "header",
      forceBreak: false,
      node: (
        <div data-page-unit data-unit-id="header">
          {/* タイトル */}
          <div className="text-center font-bold text-[20px] tracking-[0.4em] pb-[6px]" style={{ color: C.brand, borderBottom: `3px solid ${C.brand}`, marginBottom: `${st.layout.headerGapMm}mm` }}>
            {config.docTitle}
          </div>

          {/* 宛先 / 自社 */}
          <div className="flex justify-between gap-5" style={{ marginBottom: `${st.layout.headerGapMm}mm` }}>
            <div className="flex-1">
              <div className="flex items-end justify-between border-b border-black pb-1">
                <span className="text-[16px] font-bold flex-1">
                  <T readOnly={readOnly} value={st.toName} placeholder="請求先 名称" bold onChange={(v) => set({ toName: v })} />
                </span>
                <button type="button" disabled={readOnly} onClick={() => set({ honorific: st.honorific === "御中" ? "様" : "御中" })} className="text-[14px] ml-2" title={readOnly ? undefined : "クリックで御中/様"}>
                  {st.honorific || "御中"}
                </button>
              </div>
              <div className="mt-1 text-[12px] leading-[1.5]">
                {readOnly ? (
                  <div dangerouslySetInnerHTML={{ __html: st.toAddrHtml || "〒<br/>（住所）" }} />
                ) : (
                  <AddressArea html={st.toAddrHtml} onChange={(v) => set({ toAddrHtml: v })} />
                )}
                {/* 請求先の電話・登録番号。未設定ならラベルごと出さない */}
                <LabeledLine readOnly={readOnly} label="電話：" value={st.toTel} onChange={(v) => set({ toTel: v })} />
                <LabeledLine readOnly={readOnly} label="登録番号：" value={st.toReg} onChange={(v) => set({ toReg: v })} />
              </div>
              <div className="mt-6 text-[12px]">下記の通りご請求申し上げます。</div>
            </div>

            <div className="relative shrink-0 w-[42%]">
              {shouldShowIssuerStamp ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={invoiceIssuer.stampPath}
                  alt=""
                  aria-hidden="true"
                  data-invoice-stamp="issuer"
                  onError={() => console.error("請求書の社印画像を読み込めませんでした", invoiceIssuer.stampPath)}
                  className="pointer-events-none absolute right-1 top-9 z-[1] block w-32 opacity-[0.85]"
                />
              ) : null}
              <div className="relative z-10 text-[12px] leading-[1.7]">
                <div className="flex"><b className="shrink-0">対象期間：</b>
                  {st.period ? <span>{st.period}</span> : <span className="text-slate-400">{readOnly ? "" : "（上部で選択）"}</span>}
                </div>
                <div className="flex"><b className="shrink-0">請求書番号：</b><T readOnly={readOnly} value={st.invoiceNo} placeholder="INV-..." onChange={(v) => set({ invoiceNo: v })} /></div>
              </div>
              <div className="relative z-10 mt-3 text-[12px] leading-[1.6]">
                <div className="text-[14px] font-semibold"><T readOnly={readOnly} value={st.fromName} placeholder="請求元 名称" bold onChange={(v) => set({ fromName: v })} /></div>
                {readOnly ? (
                  <div dangerouslySetInnerHTML={{ __html: st.fromAddrHtml || "" }} />
                ) : (
                  <AddressArea html={st.fromAddrHtml} onChange={(v) => set({ fromAddrHtml: v })} />
                )}
                <LabeledLine readOnly={readOnly} label="電話：" value={st.fromTel} onChange={(v) => set({ fromTel: v })} />
                <LabeledLine readOnly={readOnly} label="登録番号：" value={st.fromReg} onChange={(v) => set({ fromReg: v })} />
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "summary",
      forceBreak: st.blockBreaks.includes("summary"),
      node: (
        <div data-page-unit data-unit-id="summary" data-force-break={st.blockBreaks.includes("summary") ? "true" : undefined}>
          {breakToggle("summary")}
          {/* 金額見出し */}
          <div className="flex items-center justify-between w-3/5 pb-[5px] mt-3 mb-2" style={{ borderBottom: `2px solid ${C.brand}` }}>
            <div className="text-[12.5px] font-semibold">{config.amountHeadlineLabel}</div>
            <div className="text-[18px] font-bold text-right" style={{ color: C.brand }}>
              ¥{jpy(totals.total)}
              {st.taxEnabled ? `（税込 ${taxNote}）` : ""}
            </div>
          </div>

          {/* サマリー表（二重線の外枠で強調） */}
          <div className="mt-2" style={{ marginBottom: `${st.layout.summaryGapMm}mm` }}>
            <div className="flex">
              <div className="flex-1" />
              <div className="w-[22%] text-right font-semibold text-[11px] py-[1px] px-[9px]" style={{ color: C.brand }}>（円）</div>
            </div>
            <div style={{ border: `8px double ${C.brand}`, padding: "3px" }}>
              <table className="w-full border-collapse text-[12px]">
                <tbody>
                  {config.summaryRows.map((row, i) => {
                    const editable = !readOnly && row.value.kind === "manual";
                    const field = row.value.kind === "manual" ? row.value.field : null;
                    // extraOutsourcing欄は現在の表示モードに応じて「税込」「税抜」を動的に付与する
                    // （行ごとにpriceBasisが異なりうるため、帳票全体でどちらの基準の値かを明示する）。
                    const label =
                      field === "extraOutsourcing"
                        ? `${row.label}（${st.displayBasis === "inclusive" ? "税込" : "税抜"}）`
                        : withTaxNote(row.label);
                    return (
                      <tr key={i}>
                        <td className="py-[3.5px] px-[9px] text-left font-bold" style={{ border: `1px solid ${C.brand}`, backgroundColor: C.brandSoft }}>
                          {label}
                        </td>
                        <td className="py-[3.5px] px-[9px] text-right font-bold w-[22%]" style={{ border: `1px solid ${C.brand}` }}>
                          <span className="inline-flex items-baseline justify-end">
                            {row.minus ? <span>▲</span> : null}
                            {editable && field ? (
                              (() => {
                                const extraKey = st.displayBasis === "inclusive" ? "extraOutsourcingInclusive" : "extraOutsourcingExclusive";
                                const v = field === "loanRepay" ? st.loanRepay : st[extraKey];
                                const display = editableNumDisplay(v, summaryFocus === field);
                                return (
                                  <input
                                    value={display}
                                    inputMode="decimal"
                                    placeholder="0"
                                    onFocus={() => setSummaryFocus(field)}
                                    onBlur={() => setSummaryFocus((cur) => (cur === field ? null : cur))}
                                    onChange={(e) => set(field === "loanRepay" ? { loanRepay: e.target.value } : { [extraKey]: e.target.value })}
                                    className="bg-transparent outline-none text-right font-bold p-0"
                                    style={{ width: `calc(${Math.max(1, display.length)}ch + 2px)` }}
                                  />
                                );
                              })()
                            ) : (
                              <span>{jpy(resolveSummaryValue(row.value, totals, st))}</span>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="text-white font-bold text-[15px]">
                    <td className="py-[3.5px] px-[9px] text-left" style={{ border: `1px solid ${C.brand}`, backgroundColor: C.brand }}>{config.finalLabel}</td>
                    <td className="py-[3.5px] px-[9px] text-right" style={{ border: `1px solid ${C.brand}`, backgroundColor: C.brand }}>{jpy(totals.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ),
    },
    ...buildLineTableBlocks({
      readOnly,
      section: "main",
      lines: st.main,
      title: config.billSectionTitle,
      color: C.bill,
      soft: C.billSoft,
      subtotal: totals.billSubtotal,
      tax: totals.billTax,
      gross: totals.billGross,
      subtotalLabel: st.taxEnabled ? "小計（税抜）" : "小計",
      taxLabel: st.taxEnabled ? `消費税額（小計分 ${ratePct}%）` : "",
      grossLabel: st.taxEnabled ? "税込合計" : "合計",
      displayBasis: st.displayBasis,
      sectionForceBreak: st.blockBreaks.includes("main"),
      breakToggle: breakToggle("main"),
      setLine,
      grid,
      keepLastWithNext: !config.showDeductTable,
    }),
    ...(config.showDeductTable
      ? buildLineTableBlocks({
          readOnly,
          section: "deduct",
          lines: st.deduct,
          title: config.deductSectionTitle,
          color: C.deduct,
          soft: C.deductSoft,
          subtotal: totals.deductSubtotal,
          tax: totals.deductTax,
          gross: totals.deductGross,
          subtotalLabel: st.taxEnabled ? `${config.deductSectionTitle}小計（税抜）` : `${config.deductSectionTitle}小計`,
          taxLabel: st.taxEnabled ? `消費税額（${config.deductSectionTitle} ${ratePct}%）` : "",
          grossLabel: st.taxEnabled ? "税込合計" : "合計",
          displayBasis: st.displayBasis,
          styleFirst: { marginTop: `${st.layout.deductGapMm}mm` },
          sectionForceBreak: st.blockBreaks.includes("deduct"),
          breakToggle: breakToggle("deduct"),
          setLine,
          grid,
          keepLastWithNext: true,
        })
      : []),
    {
      id: "bank",
      forceBreak: st.blockBreaks.includes("bank"),
      node: (
        <div data-page-unit data-unit-id="bank" data-force-break={st.blockBreaks.includes("bank") ? "true" : undefined} className="mt-[14px] pt-2 text-[11.5px] leading-[1.4]" style={{ borderTop: `2.5px solid ${C.brand}` }}>
          {breakToggle("bank")}
          <div className="grid grid-cols-[80px_1fr] items-center"><b>振込期日</b>
            {st.dueDate ? <span>{formatDateJa(st.dueDate)}</span> : <span className="text-slate-400">{readOnly ? "" : "（上部で選択）"}</span>}
          </div>
          <div className="grid grid-cols-[80px_1fr] items-center"><b>振込先</b><T readOnly={readOnly} value={st.bankName} onChange={(v) => set({ bankName: v })} /></div>
          <div className="grid grid-cols-[80px_1fr] items-center"><span /><T readOnly={readOnly} value={st.bankNo} onChange={(v) => set({ bankNo: v })} /></div>
          <div className="grid grid-cols-[80px_1fr] items-center"><span /><T readOnly={readOnly} value={st.bankHolder} onChange={(v) => set({ bankHolder: v })} /></div>
        </div>
      ),
    },
  ];

  let content: ReactNode;
  let outerClassName: string | undefined;
  let outerStyle: CSSProperties | undefined;

  if (!pageIndexOf) {
    // 素の連続レイアウト（計測用クローン、または pageIndexOf 到着前の初期表示）。
    content = <>{blocks.map((b) => <Fragment key={b.id}>{b.node}</Fragment>)}</>;
    outerClassName = cn(printRoot && "invoice-print-root", "mx-auto bg-white text-[#111] shadow-md w-[210mm] min-h-[297mm]");
    outerStyle = { padding: PAGE_PADDING, boxSizing: "border-box" };
  } else {
    // ページごとにグルーピングして .invoice-page として描画する（そのまま印刷対象になる）。
    const pages: { pageIndex: number; blocks: Block[] }[] = [];
    for (const b of blocks) {
      const idx = pageIndexOf(b.id) ?? 0;
      const last = pages[pages.length - 1];
      if (last && last.pageIndex === idx) last.blocks.push(b);
      else pages.push({ pageIndex: idx, blocks: [b] });
    }
    content = (
      <>
        {pages.map((p, i) => (
          <Fragment key={p.pageIndex}>
            {i > 0 ? <div className="hide-print" style={{ height: PAGE_GAP_UI_PX }} aria-hidden /> : null}
            <div
              className="invoice-page mx-auto bg-white text-[#111] shadow-md w-[210mm] min-h-[297mm]"
              style={{ padding: PAGE_PADDING, boxSizing: "border-box" }}
            >
              {p.blocks.map((b) => <Fragment key={b.id}>{b.node}</Fragment>)}
            </div>
          </Fragment>
        ))}
      </>
    );
    outerClassName = cn(printRoot && "invoice-print-root");
    outerStyle = undefined;
  }

  const sheet = (
    <div ref={sheetRef} className={outerClassName} style={outerStyle}>
      {content}
    </div>
  );
  // printRoot=false は画面専用の非表示計測クローン（PaginatedInvoiceSheet 参照）。
  // 印刷対象になる外側の灰色ラッパー（bg-slate-100 py-6）は不要なので素の帳票のみ返す。
  if (!printRoot) return sheet;
  return <div className={cn("bg-slate-100 overflow-auto py-6", className)}>{sheet}</div>;
}
