import type { Ref } from "react";
import { computeInvoiceTotals } from "@repo/core/logic/reward";
import type { InvoiceTotals } from "@repo/core/types";
import { cn } from "@/lib/ui/utils";
import {
  INVOICE_KIND_CONFIG,
  type InvoiceKind,
  type SummaryRowDef,
} from "./invoiceKinds";

// 御請求書（A4帳票）の読み取り専用表示コンポーネント。
// 種別（売上請求書 / 受領請求書）ごとの設定（invoiceKinds.ts）に従って
// タイトル・色・サマリー項目を出し分ける。計算は @repo/core に集約。

/** 帳票1行（税抜単価モデル）。 */
export type InvoiceDocLine = {
  title: string;
  qty: number;
  unit: string;
  price: number;
};

/** 帳票表示に必要なデータ一式（payload から adapter で組み立てる）。 */
export type InvoiceDocData = {
  kind: InvoiceKind;
  // 宛先（請求先）
  toName: string;
  toAddrHtml: string;
  toTel?: string;
  toReg?: string;
  honorific: string;
  // 自社/差出（請求元）
  fromName: string;
  fromAddrHtml: string;
  fromTel?: string;
  fromReg?: string;
  showStamp: boolean;
  // メタ
  period: string;
  invoiceNo: string;
  // 金額
  taxEnabled: boolean;
  taxRatePercent: number;
  main: InvoiceDocLine[];
  deduct: InvoiceDocLine[];
  loanRepay: number;
  extraOutsourcing: number;
  // 振込先
  dueDate: string;
  bankName: string;
  bankNo: string;
  bankHolder: string;
  notes: string;
};

const jpy = (n: number) => Number(n || 0).toLocaleString("ja-JP");
const priceFmt = (n: number) =>
  Number(n || 0).toLocaleString("ja-JP", { maximumFractionDigits: 2 });

function resolveSummaryValue(
  ref: SummaryRowDef["value"],
  totals: InvoiceTotals,
  data: InvoiceDocData,
): number {
  if (ref.kind === "total") return totals[ref.key];
  return ref.field === "loanRepay" ? data.loanRepay : data.extraOutsourcing;
}

/** 明細テーブル（上段=請求/報酬, 下段=お支払い/控除）。color で色テーマを切替。 */
function LineItemsTable({
  sectionTitle,
  color,
  soft,
  lines,
  subtotal,
  tax,
  gross,
  taxLabel,
  subtotalLabel,
  className,
}: {
  sectionTitle: string;
  color: string;
  soft: string;
  lines: InvoiceDocLine[];
  subtotal: number;
  tax: number;
  gross: number;
  taxLabel: string;
  subtotalLabel: string;
  className?: string;
}) {
  return (
    <table
      className={cn("w-full border-collapse text-[11.5px]", className)}
      style={{ border: `4px solid ${color}` }}
    >
      <thead>
        <tr>
          <th
            colSpan={5}
            className="bg-white py-[3px] px-2 text-center text-[12.5px] font-bold tracking-[4px]"
            style={{ color, border: `1px solid ${color}` }}
          >
            {sectionTitle}
          </th>
        </tr>
        <tr className="text-white font-semibold">
          <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "40%" }}>摘要</th>
          <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "11%" }}>数量</th>
          <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "9%" }}>単位</th>
          <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "18%" }}>税抜単価（円）</th>
          <th className="py-[3px] px-2 text-center" style={{ backgroundColor: color, border: `1px solid ${color}`, width: "22%" }}>税抜合計（円）</th>
        </tr>
      </thead>
      <tbody>
        {lines.length === 0 ? (
          <tr>
            <td className="py-[2.5px] px-2 leading-[1.3] bg-white" style={{ border: `1px solid ${color}` }}>&nbsp;</td>
            <td className="py-[2.5px] px-2 bg-white" style={{ border: `1px solid ${color}` }} />
            <td className="py-[2.5px] px-2 bg-white" style={{ border: `1px solid ${color}` }} />
            <td className="py-[2.5px] px-2 bg-white" style={{ border: `1px solid ${color}` }} />
            <td className="py-[2.5px] px-2 text-right bg-white" style={{ border: `1px solid ${color}` }}>0</td>
          </tr>
        ) : (
          lines.map((ln, i) => (
            <tr key={i}>
              <td className="py-[2.5px] px-2 leading-[1.3] bg-white" style={{ border: `1px solid ${color}` }}>{ln.title}</td>
              <td className="py-[2.5px] px-2 text-right bg-white" style={{ border: `1px solid ${color}` }}>{ln.qty ? jpy(ln.qty) : ""}</td>
              <td className="py-[2.5px] px-2 text-center bg-white" style={{ border: `1px solid ${color}` }}>{ln.unit}</td>
              <td className="py-[2.5px] px-2 text-right bg-white" style={{ border: `1px solid ${color}` }}>{ln.price ? priceFmt(ln.price) : ""}</td>
              <td className="py-[2.5px] px-2 text-right bg-white" style={{ border: `1px solid ${color}` }}>{jpy(Math.round(ln.qty * ln.price))}</td>
            </tr>
          ))
        )}
      </tbody>
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
          <td colSpan={4} className="py-[2.5px] px-2 text-right" style={{ border: `1px solid ${color}`, backgroundColor: color }}>税込合計</td>
          <td className="py-[2.5px] px-2 text-right" style={{ border: `1px solid ${color}`, backgroundColor: color }}>{jpy(gross)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

export function InvoiceDocument({
  data,
  sheetRef,
  className,
}: {
  data: InvoiceDocData;
  sheetRef?: Ref<HTMLDivElement>;
  className?: string;
}) {
  const config = INVOICE_KIND_CONFIG[data.kind] ?? INVOICE_KIND_CONFIG.outgoing;
  const T = config.theme;
  const main = data.main ?? [];
  const deduct = data.deduct ?? [];
  const totals = computeInvoiceTotals({
    main,
    deduct,
    taxEnabled: data.taxEnabled,
    taxRatePercent: data.taxRatePercent,
    loanRepay: data.loanRepay,
    extraOutsourcing: data.extraOutsourcing,
  });
  const ratePct = Math.round(Number(data.taxRatePercent) || 0);

  return (
    <div className={cn("bg-slate-100 overflow-auto py-6", className)}>
      <div
        ref={sheetRef}
        className="mx-auto bg-white text-[#111] shadow-md w-[210mm] min-h-[297mm]"
        style={{ padding: "14mm 14mm 12mm 14mm", boxSizing: "border-box" }}
      >
        {/* タイトル */}
        <div
          className="text-center font-bold text-[20px] tracking-[0.4em] pb-[6px] mb-[14px]"
          style={{ color: T.brand, borderBottom: `3px solid ${T.brand}` }}
        >
          {config.docTitle}
        </div>

        {/* 宛先 / 自社 */}
        <div className="flex justify-between gap-5 mb-[14px]">
          <div className="flex-1">
            <div className="flex items-end justify-between border-b border-black pb-1">
              <span className="text-[16px] font-bold">{data.toName || "株式会社"}</span>
              <span className="text-[14px]">{data.honorific || "御中"}</span>
            </div>
            <div
              className="mt-1 text-[12px] leading-[1.5]"
              dangerouslySetInnerHTML={{ __html: data.toAddrHtml || "〒<br/>（住所）" }}
            />
            {data.toTel ? <div className="text-[12px]">電話：{data.toTel}</div> : null}
            {data.toReg ? <div className="text-[12px]">登録番号：{data.toReg}</div> : null}
            <div className="mt-6 text-[12px]">下記の通りご請求申し上げます。</div>
          </div>

          <div className="relative shrink-0 min-w-[250px]">
            {data.showStamp ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/invoice/ACE_CREATION_stamp_1.png" alt="" className="absolute right-0 top-8 w-20 opacity-90" />
            ) : null}
            <div className="text-[12px] leading-[1.7]">
              <div><b>請求期間：</b>{data.period}</div>
              <div><b>請求書番号：</b>{data.invoiceNo}</div>
            </div>
            <div className="mt-3 text-[12px] leading-[1.6]">
              <div className="text-[14px] font-semibold">{data.fromName}</div>
              <div dangerouslySetInnerHTML={{ __html: data.fromAddrHtml || "" }} />
              {data.fromTel ? <div>電話：{data.fromTel}</div> : null}
              {data.fromReg ? <div>登録番号：{data.fromReg}</div> : null}
            </div>
          </div>
        </div>

        {/* 金額見出し */}
        <div
          className="flex items-center justify-between w-3/5 pb-[5px] mt-3 mb-2"
          style={{ borderBottom: `2px solid ${T.brand}` }}
        >
          <div className="text-[12.5px] font-semibold">{config.amountHeadlineLabel}</div>
          <div className="text-[18px] font-bold text-right" style={{ color: T.brand }}>
            ¥{jpy(totals.total)}（税込）
          </div>
        </div>

        {/* サマリー表 */}
        <table className="w-full border-collapse text-[12px] mt-2 mb-[26px]">
          <thead>
            <tr>
              <th className="border-0 bg-transparent" />
              <th className="border-0 bg-transparent text-right font-semibold text-[11px] py-[1px] px-[9px]" style={{ color: T.brand }}>（円）</th>
            </tr>
          </thead>
          <tbody>
            {config.summaryRows.map((row, i) => {
              const v = resolveSummaryValue(row.value, totals, data);
              const isFirst = i === 0;
              return (
                <tr key={i}>
                  <td
                    className="py-[3.5px] px-[9px] text-left font-bold"
                    style={{
                      border: `1px solid ${T.brand}`,
                      borderTop: isFirst ? `2.5px solid ${T.brand}` : undefined,
                      borderLeft: `2.5px solid ${T.brand}`,
                      backgroundColor: T.brandSoft,
                    }}
                  >
                    {row.label}
                  </td>
                  <td
                    className="py-[3.5px] px-[9px] text-right font-bold w-[22%]"
                    style={{
                      border: `1px solid ${T.brand}`,
                      borderTop: isFirst ? `2.5px solid ${T.brand}` : undefined,
                      borderRight: `2.5px solid ${T.brand}`,
                    }}
                  >
                    {row.minus ? "▲" : ""}{jpy(v)}
                  </td>
                </tr>
              );
            })}
            <tr className="text-white font-bold text-[15px]">
              <td className="py-[3.5px] px-[9px] text-left" style={{ border: `1px solid ${T.brand}`, borderBottom: `2.5px solid ${T.brand}`, borderLeft: `2.5px solid ${T.brand}`, backgroundColor: T.brand }}>{config.finalLabel}</td>
              <td className="py-[3.5px] px-[9px] text-right" style={{ border: `1px solid ${T.brand}`, borderBottom: `2.5px solid ${T.brand}`, borderRight: `2.5px solid ${T.brand}`, backgroundColor: T.brand }}>{jpy(totals.total)}</td>
            </tr>
          </tbody>
        </table>

        {/* 上段テーブル（請求分 / 報酬明細） */}
        <LineItemsTable
          sectionTitle={config.billSectionTitle}
          color={T.bill}
          soft={T.billSoft}
          lines={main}
          subtotal={totals.billSubtotal}
          tax={totals.billTax}
          gross={totals.billGross}
          subtotalLabel="小計（税抜）"
          taxLabel={data.taxEnabled ? `消費税額（小計分 ${ratePct}%）` : ""}
        />

        {/* 下段テーブル（お支払い分 / 控除） */}
        {config.showDeductTable ? (
          <LineItemsTable
            className="mt-[34px]"
            sectionTitle={config.deductSectionTitle}
            color={T.deduct}
            soft={T.deductSoft}
            lines={deduct}
            subtotal={totals.deductSubtotal}
            tax={totals.deductTax}
            gross={totals.deductGross}
            subtotalLabel={`${config.deductSectionTitle}小計（税抜）`}
            taxLabel={data.taxEnabled ? `消費税額（${config.deductSectionTitle} ${ratePct}%）` : ""}
          />
        ) : null}

        {/* 振込先 */}
        <div className="mt-[14px] pt-2 text-[11.5px] leading-[1.4]" style={{ borderTop: `2.5px solid ${T.brand}` }}>
          <div className="grid grid-cols-[80px_1fr]"><b>振込期日</b><span>{data.dueDate}</span></div>
          <div className="grid grid-cols-[80px_1fr]"><b>振込先</b><span>{data.bankName}</span></div>
          <div className="grid grid-cols-[80px_1fr]"><span /><span>{data.bankNo}</span></div>
          <div className="grid grid-cols-[80px_1fr]"><span /><span>{data.bankHolder}</span></div>
          {data.notes ? <div className="grid grid-cols-[80px_1fr] mt-1"><span /><span>{data.notes}</span></div> : null}
        </div>
      </div>
    </div>
  );
}
