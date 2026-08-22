"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft, faBox, faCircleInfo, faCoins, faRoute } from "@fortawesome/free-solid-svg-icons";
import Link from "next/link";
import { CourseRateEditor, type CourseRatePreviewData } from "@/lib/components/CourseRateEditor";

const cycles = [
  { cycleNo: 1, label: "1便" },
  { cycleNo: 2, label: "2便" },
];

const previewData: CourseRatePreviewData = {
  courseName: "Amazon 上鳥羽吉祥院",
  carrierId: "preview-amazon",
  revenueTaxBasis: "exclusive",
  payoutTaxBasis: "inclusive",
  revenuePieceTaxBasis: "exclusive",
  revenueFixedTaxBasis: "exclusive",
  payoutPieceTaxBasis: "inclusive",
  payoutFixedTaxBasis: "exclusive",
  revenueRateMode: "BOTH",
  payoutRateMode: "BOTH",
  units: [{ id: "preview-parcel", name: "配完個数", code: "DELIVERED", billing_type: "PER_PIECE" }],
  unitRates: [
    { cycle_no: 1, unit_id: "preview-parcel", revenue_per_unit: 160, profit_per_unit: 24, payout_per_unit: 136, revenue_contract_amount: 160, payout_contract_amount: 150 },
    { cycle_no: 2, unit_id: "preview-parcel", revenue_per_unit: 160, profit_per_unit: 24, payout_per_unit: 136, revenue_contract_amount: 160, payout_contract_amount: 150 },
  ],
  fixed: { fixed_revenue: 17000, fixed_profit: 5182, fixed_payout: 11818 },
  fixedRates: [
    { cycle_no: 1, fixed_revenue: 8500, fixed_profit: 2591, fixed_payout: 5909, revenue_contract_amount: 8500, payout_contract_amount: 6500 },
    { cycle_no: 2, fixed_revenue: 8500, fixed_profit: 2591, fixed_payout: 5909, revenue_contract_amount: 8500, payout_contract_amount: 6500 },
  ],
  fixedBundle: { required_cycle_nos: [1, 2], revenue_contract_amount: 17000, payout_contract_amount: 13000 },
};

export default function CourseRatePreviewPage() {
  return (
    <main className="min-h-screen bg-slate-200 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-3xl bg-white shadow-xl shadow-slate-300/40">
        <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-5 sm:px-8">
          <Link href="/preview" aria-label="プレビュー一覧へ戻る" className="mr-1 text-slate-400 transition-colors hover:text-slate-700">
            <FontAwesomeIcon icon={faArrowLeft} />
          </Link>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><FontAwesomeIcon icon={faBox} /></div>
          <span className="h-3 w-3 rounded-full bg-amber-500" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-slate-900 sm:text-xl">Amazon 上鳥羽吉祥院</h1>
            <p className="text-xs text-slate-500">Amazon</p>
          </div>
          <span className="hidden text-xs text-slate-400 sm:block">B4｜一体型フロー</span>
        </header>

        <nav className="flex gap-1 border-b border-slate-200 px-4 sm:px-8" aria-label="コース編集タブ">
          {([
            ["基本情報", faCircleInfo],
            ["運行設定", faRoute],
            ["単価設定", faCoins],
          ] as const).map(([label, icon]) => (
            <button key={label} type="button" disabled={label !== "単価設定"}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${label === "単価設定" ? "border-amber-500 text-amber-700" : "border-transparent text-slate-400"}`}>
              <FontAwesomeIcon icon={icon} className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </nav>

        <div className="px-5 py-7 sm:px-10 lg:px-16">
          <CourseRateEditor courseId={null} carrierId="preview-amazon" usesCycles cycles={cycles}
            previewData={previewData} onError={() => undefined} />
          <p className="mt-6 text-xs text-slate-400">開発用プレビューです。入力内容は保存されません。</p>
        </div>
      </div>
    </main>
  );
}
