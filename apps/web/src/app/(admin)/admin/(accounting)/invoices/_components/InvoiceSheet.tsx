import type { Ref } from "react";
import { computeInvoiceTotals } from "@repo/core/logic/reward";
import type { InvoiceTotals } from "@repo/core/types";
import { cn } from "@/lib/ui/utils";
import { INVOICE_KIND_CONFIG, type SummaryRowDef } from "./invoiceKinds";
import {
  type EditorState,
  type EditorLine,
  emptyLine,
  docDataFromEditor,
} from "./editorModel";

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
}: {
  readOnly: boolean;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  className?: string;
  align?: "left" | "right" | "center";
  bold?: boolean;
}) {
  if (readOnly) return <span className={cn(bold && "font-bold", className)}>{value}</span>;
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn("bg-transparent outline-none focus:bg-blue-50 rounded-sm w-full", bold && "font-bold", className)}
      style={{ textAlign: align }}
    />
  );
}

type Section = "main" | "deduct";

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
  removeLine,
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
  removeLine: (section: Section, i: number) => void;
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
          {!readOnly ? <th className="w-7" style={{ border: "none" }} /> : null}
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
            <tr key={i}>
              <td className="py-[2.5px] px-2 leading-[1.3] bg-white" style={{ border: `1px solid ${color}` }}>
                <T readOnly={readOnly} value={ln.title} placeholder="摘要" onChange={(v) => setLine(section, i, { title: v })} />
              </td>
              <td className="py-[2.5px] px-2 bg-white" style={{ border: `1px solid ${color}` }}>
                <T readOnly={readOnly} value={readOnly ? (ln.qty ? jpy(num(ln.qty)) : "") : ln.qty} align="right" placeholder="0" onChange={(v) => setLine(section, i, { qty: v })} />
              </td>
              <td className="py-[2.5px] px-2 bg-white" style={{ border: `1px solid ${color}` }}>
                <T readOnly={readOnly} value={ln.unit} align="center" placeholder="件" onChange={(v) => setLine(section, i, { unit: v })} />
              </td>
              <td className="py-[2.5px] px-2 bg-white" style={{ border: `1px solid ${color}` }}>
                <T readOnly={readOnly} value={readOnly ? (ln.price ? priceDisplay(ln.price) : "") : ln.price} align="right" placeholder="0" onChange={(v) => setLine(section, i, { price: v })} />
              </td>
              <td className="py-[2.5px] px-2 text-right bg-white" style={{ border: `1px solid ${color}` }}>
                {jpy(Math.round(num(ln.qty) * num(ln.price)))}
              </td>
              {!readOnly ? (
                <td className="text-center align-middle">
                  <button type="button" onClick={() => removeLine(section, i)} className="text-slate-400 hover:text-red-500 text-sm hide-print">×</button>
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
  const removeLine = (section: Section, i: number) =>
    set({ [section]: st[section].filter((_, idx) => idx !== i) } as Partial<EditorState>);

  return (
    <div className={cn("bg-slate-100 overflow-auto py-6", className)}>
      <div
        ref={sheetRef}
        className="mx-auto bg-white text-[#111] shadow-md w-[210mm] min-h-[297mm]"
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
              <div className="flex"><b className="shrink-0">対象期間：</b><T readOnly={readOnly} value={st.period} placeholder="2025年5月1日〜2025年5月31日" onChange={(v) => set({ period: v })} /></div>
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
                      <T readOnly={false} value={field === "loanRepay" ? st.loanRepay : st.extraOutsourcing} align="right" className="inline-block w-20" onChange={(v) => set(field === "loanRepay" ? { loanRepay: v } : { extraOutsourcing: v })} />
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
          removeLine={removeLine}
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
            removeLine={removeLine}
            classNameTbl="mt-[34px]"
          />
        ) : null}

        {/* 振込先 */}
        <div className="mt-[14px] pt-2 text-[11.5px] leading-[1.4]" style={{ borderTop: `2.5px solid ${C.brand}` }}>
          <div className="grid grid-cols-[80px_1fr] items-center"><b>振込期日</b><T readOnly={readOnly} value={st.dueDate} onChange={(v) => set({ dueDate: v })} /></div>
          <div className="grid grid-cols-[80px_1fr] items-center"><b>振込先</b><T readOnly={readOnly} value={st.bankName} onChange={(v) => set({ bankName: v })} /></div>
          <div className="grid grid-cols-[80px_1fr] items-center"><span /><T readOnly={readOnly} value={st.bankNo} onChange={(v) => set({ bankNo: v })} /></div>
          <div className="grid grid-cols-[80px_1fr] items-center"><span /><T readOnly={readOnly} value={st.bankHolder} onChange={(v) => set({ bankHolder: v })} /></div>
        </div>
      </div>
    </div>
  );
}
