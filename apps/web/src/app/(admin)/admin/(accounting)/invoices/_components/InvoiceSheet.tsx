import {
  type Ref,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  useRef,
  useState,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGripVertical, faPlus, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { computeInvoiceTotals } from "@repo/core/logic/reward";
import type { InvoiceTotals } from "@repo/core/types";
import { cn } from "@/lib/ui/utils";
import { INVOICE_KIND_CONFIG, type SummaryRowDef } from "./invoiceKinds";
import {
  type EditorState,
  type EditorLine,
  emptyLine,
  docDataFromEditor,
  formatDateJa,
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

/** 明細テーブルのスプレッドシート編集API（!readOnly のときだけ供給）。 */
type GridApi = {
  isFillTarget: (section: Section, row: number, col: number) => boolean;
  cellProps: (
    section: Section,
    row: number,
    col: number,
  ) => {
    "data-cell": string;
    onFocus: () => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
    onPaste: (e: ReactClipboardEvent<HTMLInputElement>) => void;
  };
  fillHandle: (section: Section, row: number, col: number) => ReactNode;
  rowControls: (section: Section, row: number) => ReactNode;
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
// 注意: 入力欄を持つサブコンポーネント（T / LineTable）は必ずモジュールレベルに定義する。
// 関数内で定義すると毎レンダーで別物と見なされ再マウント→フォーカス喪失（IME/複数桁入力不可）になる。

const jpy = (n: number) => Number(n || 0).toLocaleString("ja-JP");
const num = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const priceDisplay = (v: unknown) =>
  Number(num(v)).toLocaleString("ja-JP", { maximumFractionDigits: 2 });

function resolveSummaryValue(ref: SummaryRowDef["value"], totals: InvoiceTotals, st: EditorState): number {
  if (ref.kind === "total") return totals[ref.key];
  return num(ref.field === "loanRepay" ? st.loanRepay : st.extraOutsourcing);
}

/** インライン編集テキスト（readOnly のときは素のテキスト）。 */
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
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn("bg-transparent outline-none focus:bg-blue-50 rounded-sm w-full", bold && "font-bold", className)}
      style={{ textAlign: align }}
    />
  );
}

/** 明細テーブル（請求/報酬・お支払い/控除）。モジュールレベル定義（再マウント防止）。 */
function LineTable({
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
  classNameTbl,
  setLine,
  addLine,
  grid,
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
  classNameTbl?: string;
  setLine: (section: Section, i: number, patch: Partial<EditorLine>) => void;
  addLine: (section: Section) => void;
  grid?: GridApi;
}) {
  return (
    <table className={cn("w-full border-collapse text-[11.5px]", classNameTbl)} style={{ border: `4px solid ${color}` }}>
      <thead>
        <tr>
          <th colSpan={readOnly ? 5 : 6} className="bg-white py-[3px] px-2 text-center text-[12.5px] font-bold tracking-[4px]" style={{ color, border: `1px solid ${color}` }}>
            {title}
          </th>
        </tr>
        <tr className="text-white font-semibold">
          <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "40%" }}>摘要</th>
          <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "11%" }}>数量</th>
          <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "9%" }}>単位</th>
          <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "18%" }}>税抜単価（円）</th>
          <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "22%" }}>税抜合計（円）</th>
          {!readOnly ? <th className="w-14 hide-print" style={{ border: "none" }} /> : null}
        </tr>
      </thead>
      <tbody>
        {lines.length === 0 ? (
          <tr>
            <td className="py-[2.5px] px-2 bg-white" style={{ border: `1px solid ${color}` }}>&nbsp;</td>
            <td className="bg-white" style={{ border: `1px solid ${color}` }} />
            <td className="bg-white" style={{ border: `1px solid ${color}` }} />
            <td className="bg-white" style={{ border: `1px solid ${color}` }} />
            <td className="text-right px-2 bg-white" style={{ border: `1px solid ${color}` }}>0</td>
            {!readOnly ? <td /> : null}
          </tr>
        ) : (
          lines.map((ln, i) => (
            <tr key={i} {...(grid ? grid.rowProps(section, i) : {})}>
              <td className={cn("py-[2.5px] px-2 leading-[1.3] bg-white relative", grid?.isFillTarget(section, i, 0) && "bg-blue-50")} style={{ border: `1px solid ${color}` }}>
                <T readOnly={readOnly} value={ln.title} placeholder="摘要" onChange={(v) => setLine(section, i, { title: v })} {...(grid ? grid.cellProps(section, i, 0) : {})} />
                {grid ? grid.fillHandle(section, i, 0) : null}
              </td>
              <td className={cn("py-[2.5px] px-2 bg-white relative", grid?.isFillTarget(section, i, 1) && "bg-blue-50")} style={{ border: `1px solid ${color}` }}>
                <T readOnly={readOnly} value={readOnly ? (ln.qty ? jpy(num(ln.qty)) : "") : ln.qty} align="right" placeholder="0" inputMode="decimal" onChange={(v) => setLine(section, i, { qty: v })} {...(grid ? grid.cellProps(section, i, 1) : {})} />
                {grid ? grid.fillHandle(section, i, 1) : null}
              </td>
              <td className={cn("py-[2.5px] px-2 bg-white relative", grid?.isFillTarget(section, i, 2) && "bg-blue-50")} style={{ border: `1px solid ${color}` }}>
                <T readOnly={readOnly} value={ln.unit} align="center" placeholder="件" onChange={(v) => setLine(section, i, { unit: v })} {...(grid ? grid.cellProps(section, i, 2) : {})} />
                {grid ? grid.fillHandle(section, i, 2) : null}
              </td>
              <td className={cn("py-[2.5px] px-2 bg-white relative", grid?.isFillTarget(section, i, 3) && "bg-blue-50")} style={{ border: `1px solid ${color}` }}>
                <T readOnly={readOnly} value={readOnly ? (ln.price ? priceDisplay(ln.price) : "") : ln.price} align="right" placeholder="0" inputMode="decimal" onChange={(v) => setLine(section, i, { price: v })} {...(grid ? grid.cellProps(section, i, 3) : {})} />
                {grid ? grid.fillHandle(section, i, 3) : null}
              </td>
              <td className="py-[2.5px] px-2 text-right bg-white" style={{ border: `1px solid ${color}` }}>
                {jpy(Math.round(num(ln.qty) * num(ln.price)))}
              </td>
              {grid ? (
                <td className="align-middle pl-1 hide-print" style={{ border: "none" }}>
                  {grid.rowControls(section, i)}
                </td>
              ) : null}
            </tr>
          ))
        )}
        {!readOnly ? (
          <tr className="hide-print">
            <td colSpan={6} className="py-1 px-2" style={{ border: "none" }}>
              <button type="button" onClick={() => addLine(section)} className="text-xs text-slate-600 underline hover:text-slate-900">＋ 行を追加</button>
            </td>
          </tr>
        ) : null}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4} className="py-[2.5px] px-2 text-right font-semibold" style={{ border: `1px solid ${color}`, backgroundColor: soft }}>{subtotalLabel}</td>
          <td className="py-[2.5px] px-2 text-right bg-white" style={{ border: `1px solid ${color}` }}>{jpy(subtotal)}</td>
          {!readOnly ? <td /> : null}
        </tr>
        {taxLabel ? (
          <tr>
            <td colSpan={4} className="py-[2.5px] px-2 text-right font-semibold" style={{ border: `1px solid ${color}`, backgroundColor: soft }}>{taxLabel}</td>
            <td className="py-[2.5px] px-2 text-right bg-white" style={{ border: `1px solid ${color}` }}>{jpy(tax)}</td>
            {!readOnly ? <td /> : null}
          </tr>
        ) : null}
        <tr className="font-bold text-white">
          <td colSpan={4} className="py-[2.5px] px-2 text-right" style={{ border: `1px solid ${color}`, backgroundColor: color }}>税込合計</td>
          <td className="py-[2.5px] px-2 text-right" style={{ border: `1px solid ${color}`, backgroundColor: color }}>{jpy(gross)}</td>
          {!readOnly ? <td /> : null}
        </tr>
      </tfoot>
    </table>
  );
}

export function InvoiceSheet({
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
  const st = state;
  const config = INVOICE_KIND_CONFIG[st.kind] ?? INVOICE_KIND_CONFIG.outgoing;
  const C = config.theme;
  const doc = docDataFromEditor(st);
  const totals = computeInvoiceTotals({
    main: doc.main,
    deduct: doc.deduct,
    taxEnabled: st.taxEnabled,
    taxRatePercent: num(st.taxRatePercent),
    loanRepay: num(st.loanRepay),
    extraOutsourcing: num(st.extraOutsourcing),
  });
  const ratePct = Math.round(num(st.taxRatePercent));

  const set = (patch: Partial<EditorState>) => onChange?.({ ...st, ...patch });
  const setLine = (section: Section, i: number, patch: Partial<EditorLine>) =>
    set({ [section]: st[section].map((l, idx) => (idx === i ? { ...l, ...patch } : l)) } as Partial<EditorState>);
  const addLine = (section: Section) =>
    set({ [section]: [...st[section], emptyLine()] } as Partial<EditorState>);

  // ── スプレッドシート編集（選択/フィル/並べ替え）。状態は描画用＋最新参照用 ref の二重持ち ──
  const [active, setActive] = useState<{ section: Section; row: number; col: number } | null>(null);
  const [fill, setFill] = useState<{ section: Section; col: number; fromRow: number; toRow: number } | null>(null);
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

  const grid: GridApi | undefined = readOnly
    ? undefined
    : {
        isFillTarget: (section, row, col) => {
          if (!fill || fill.section !== section || fill.col !== col) return false;
          const lo = Math.min(fill.fromRow, fill.toRow);
          const hi = Math.max(fill.fromRow, fill.toRow);
          return row >= lo && row <= hi;
        },
        cellProps: (section, row, col) => ({
          "data-cell": `${section}|${row}|${col}`,
          onFocus: () => setActive({ section, row, col }),
          onKeyDown: (e) => {
            const lines = stRef.current[section];
            if (e.key === "Enter") {
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
                focusCell(section, row + 1, col);
              }
            } else if (e.key === "ArrowUp") {
              if (row > 0) {
                e.preventDefault();
                focusCell(section, row - 1, col);
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
        rowControls: (section, row) => (
          <div className="flex items-center gap-2 text-slate-300">
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
            <button type="button" onClick={() => setLines(section, removeLineAt(stRef.current[section], row))} title="行を削除" className="hover:text-red-500">
              <FontAwesomeIcon icon={faTrashCan} className="h-3 w-3" />
            </button>
          </div>
        ),
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

  return (
    <div className={cn("bg-slate-100 overflow-auto py-6", className)}>
      <div
        ref={sheetRef}
        className="invoice-print-root mx-auto bg-white text-[#111] shadow-md w-[210mm] min-h-[297mm]"
        style={{ padding: "14mm 14mm 12mm 14mm", boxSizing: "border-box" }}
      >
        {/* タイトル */}
        <div className="text-center font-bold text-[20px] tracking-[0.4em] pb-[6px] mb-[14px]" style={{ color: C.brand, borderBottom: `3px solid ${C.brand}` }}>
          {config.docTitle}
        </div>

        {/* 宛先 / 自社 */}
        <div className="flex justify-between gap-5 mb-[14px]">
          <div className="flex-1">
            <div className="flex items-end justify-between border-b border-black pb-1">
              <span className="text-[16px] font-bold flex-1">
                <T readOnly={readOnly} value={st.toName} placeholder="請求先 名称" bold onChange={(v) => set({ toName: v })} />
              </span>
              <button type="button" disabled={readOnly} onClick={() => set({ honorific: st.honorific === "御中" ? "様" : "御中" })} className="text-[14px] ml-2" title={readOnly ? undefined : "クリックで御中/様"}>
                {st.honorific || "御中"}
              </button>
            </div>
            {readOnly ? (
              <div className="mt-1 text-[12px] leading-[1.5]" dangerouslySetInnerHTML={{ __html: st.toAddrHtml || "〒<br/>（住所）" }} />
            ) : (
              <textarea value={st.toAddrHtml.replace(/<br\s*\/?>/gi, "\n")} placeholder={"〒\n（住所）"} onChange={(e) => set({ toAddrHtml: e.target.value.replace(/\n/g, "<br/>") })} className="mt-1 text-[12px] leading-[1.5] w-full bg-transparent outline-none focus:bg-blue-50 rounded-sm resize-none" rows={2} />
            )}
            <div className="mt-6 text-[12px]">下記の通りご請求申し上げます。</div>
          </div>

          <div className="relative shrink-0 w-[42%]">
            {doc.showStamp ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/invoice/ACE_CREATION_stamp_1.png" alt="" className="absolute right-0 top-8 w-20 opacity-90" />
            ) : null}
            <div className="text-[12px] leading-[1.7]">
              <div className="flex"><b className="shrink-0">対象期間：</b>
                {st.period ? <span>{st.period}</span> : <span className="text-slate-400">{readOnly ? "" : "（上部で選択）"}</span>}
              </div>
              <div className="flex"><b className="shrink-0">請求書番号：</b><T readOnly={readOnly} value={st.invoiceNo} placeholder="INV-..." onChange={(v) => set({ invoiceNo: v })} /></div>
            </div>
            <div className="mt-3 text-[12px] leading-[1.6]">
              <div className="text-[14px] font-semibold"><T readOnly={readOnly} value={st.fromName} placeholder="請求元 名称" bold onChange={(v) => set({ fromName: v })} /></div>
              {readOnly ? (
                <div dangerouslySetInnerHTML={{ __html: st.fromAddrHtml || "" }} />
              ) : (
                <textarea value={st.fromAddrHtml.replace(/<br\s*\/?>/gi, "\n")} placeholder={"〒\n（住所）"} onChange={(e) => set({ fromAddrHtml: e.target.value.replace(/\n/g, "<br/>") })} className="text-[12px] leading-[1.6] w-full bg-transparent outline-none focus:bg-blue-50 rounded-sm resize-none" rows={2} />
              )}
              {readOnly ? (
                st.fromTel ? <div>電話：{st.fromTel}</div> : null
              ) : (
                <div className="flex">電話：<T readOnly={readOnly} value={st.fromTel} onChange={(v) => set({ fromTel: v })} /></div>
              )}
              {readOnly ? (
                st.fromReg ? <div>登録番号：{st.fromReg}</div> : null
              ) : (
                <div className="flex">登録番号：<T readOnly={readOnly} value={st.fromReg} onChange={(v) => set({ fromReg: v })} /></div>
              )}
            </div>
          </div>
        </div>

        {/* 金額見出し */}
        <div className="flex items-center justify-between w-3/5 pb-[5px] mt-3 mb-2" style={{ borderBottom: `2px solid ${C.brand}` }}>
          <div className="text-[12.5px] font-semibold">{config.amountHeadlineLabel}</div>
          <div className="text-[18px] font-bold text-right" style={{ color: C.brand }}>¥{jpy(totals.total)}（税込）</div>
        </div>

        {/* サマリー表 */}
        <table className="w-full border-collapse text-[12px] mt-2 mb-[26px]">
          <thead>
            <tr>
              <th className="border-0 bg-transparent" />
              <th className="border-0 bg-transparent text-right font-semibold text-[11px] py-[1px] px-[9px]" style={{ color: C.brand }}>（円）</th>
            </tr>
          </thead>
          <tbody>
            {config.summaryRows.map((row, i) => {
              const isFirst = i === 0;
              const editable = !readOnly && row.value.kind === "manual";
              const field = row.value.kind === "manual" ? row.value.field : null;
              return (
                <tr key={i}>
                  <td className="py-[3.5px] px-[9px] text-left font-bold" style={{ border: `1px solid ${C.brand}`, borderTop: isFirst ? `2.5px solid ${C.brand}` : undefined, borderLeft: `2.5px solid ${C.brand}`, backgroundColor: C.brandSoft }}>
                    {row.label}
                  </td>
                  <td className="py-[3.5px] px-[9px] text-right font-bold w-[22%]" style={{ border: `1px solid ${C.brand}`, borderTop: isFirst ? `2.5px solid ${C.brand}` : undefined, borderRight: `2.5px solid ${C.brand}` }}>
                    {row.minus ? "▲" : ""}
                    {editable && field ? (
                      <T readOnly={false} value={field === "loanRepay" ? st.loanRepay : st.extraOutsourcing} align="right" className="inline-block w-20" inputMode="decimal" onChange={(v) => set(field === "loanRepay" ? { loanRepay: v } : { extraOutsourcing: v })} />
                    ) : (
                      jpy(resolveSummaryValue(row.value, totals, st))
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="text-white font-bold text-[15px]">
              <td className="py-[3.5px] px-[9px] text-left" style={{ border: `1px solid ${C.brand}`, borderBottom: `2.5px solid ${C.brand}`, borderLeft: `2.5px solid ${C.brand}`, backgroundColor: C.brand }}>{config.finalLabel}</td>
              <td className="py-[3.5px] px-[9px] text-right" style={{ border: `1px solid ${C.brand}`, borderBottom: `2.5px solid ${C.brand}`, borderRight: `2.5px solid ${C.brand}`, backgroundColor: C.brand }}>{jpy(totals.total)}</td>
            </tr>
          </tbody>
        </table>

        <LineTable
          readOnly={readOnly}
          section="main"
          lines={st.main}
          title={config.billSectionTitle}
          color={C.bill}
          soft={C.billSoft}
          subtotal={totals.billSubtotal}
          tax={totals.billTax}
          gross={totals.billGross}
          subtotalLabel="小計（税抜）"
          taxLabel={st.taxEnabled ? `消費税額（小計分 ${ratePct}%）` : ""}
          setLine={setLine}
          addLine={addLine}
          grid={grid}
        />

        {config.showDeductTable ? (
          <LineTable
            readOnly={readOnly}
            section="deduct"
            lines={st.deduct}
            title={config.deductSectionTitle}
            color={C.deduct}
            soft={C.deductSoft}
            subtotal={totals.deductSubtotal}
            tax={totals.deductTax}
            gross={totals.deductGross}
            subtotalLabel={`${config.deductSectionTitle}小計（税抜）`}
            taxLabel={st.taxEnabled ? `消費税額（${config.deductSectionTitle} ${ratePct}%）` : ""}
            setLine={setLine}
            addLine={addLine}
            grid={grid}
            classNameTbl="mt-[34px]"
          />
        ) : null}

        {/* 振込先 */}
        <div className="mt-[14px] pt-2 text-[11.5px] leading-[1.4]" style={{ borderTop: `2.5px solid ${C.brand}` }}>
          <div className="grid grid-cols-[80px_1fr] items-center"><b>振込期日</b>
            {st.dueDate ? <span>{formatDateJa(st.dueDate)}</span> : <span className="text-slate-400">{readOnly ? "" : "（上部で選択）"}</span>}
          </div>
          <div className="grid grid-cols-[80px_1fr] items-center"><b>振込先</b><T readOnly={readOnly} value={st.bankName} onChange={(v) => set({ bankName: v })} /></div>
          <div className="grid grid-cols-[80px_1fr] items-center"><span /><T readOnly={readOnly} value={st.bankNo} onChange={(v) => set({ bankNo: v })} /></div>
          <div className="grid grid-cols-[80px_1fr] items-center"><span /><T readOnly={readOnly} value={st.bankHolder} onChange={(v) => set({ bankHolder: v })} /></div>
        </div>
      </div>
    </div>
  );
}
