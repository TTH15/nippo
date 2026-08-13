"use client";

// ============================================================
// ナンバープレート描画のプレビュー（開発用・認証不要）。
// SVG グリフ版 VehiclePlate の大きさ・高さの自然さを目視確認する。
// フォールバック（グリフ未収録: 分類の2/7・り/れ以外のかな・収録外の地名）の混在も並べる。
// ============================================================

import { VehiclePlate } from "@/lib/components/VehiclePlate";

const SAMPLES: { label: string; v: Parameters<typeof VehiclePlate>[0]["vehicle"] }[] = [
  {
    label: "ACE CREATION 標準（京都 481 り 4桁）",
    v: { id: "1", number_prefix: "京都", number_class: "481", number_hiragana: "り", number_numeric: "1234" },
  },
  {
    label: "れ・3桁（・1-23 実物準拠ハイフン）",
    v: { id: "2", number_prefix: "京都", number_class: "480", number_hiragana: "れ", number_numeric: "123" },
  },
  {
    label: "2桁（・・12 ハイフンなし）",
    v: { id: "3", number_prefix: "大阪", number_class: "481", number_hiragana: "り", number_numeric: "12" },
  },
  {
    label: "1桁（・・・8）",
    v: { id: "4", number_prefix: "練馬", number_class: "481", number_hiragana: "れ", number_numeric: "8" },
  },
  {
    label: "かなフォールバック（わ）",
    v: { id: "5", number_prefix: "京都", number_class: "481", number_hiragana: "わ", number_numeric: "5678" },
  },
  {
    label: "分類フォールバック（427: 2・7 未収録）",
    v: { id: "6", number_prefix: "滋賀", number_class: "427", number_hiragana: "り", number_numeric: "9012" },
  },
  {
    label: "地名フォールバック（横浜: 未収録）",
    v: { id: "7", number_prefix: "横浜", number_class: "481", number_hiragana: "れ", number_numeric: "3456" },
  },
  {
    label: "奈良",
    v: { id: "8", number_prefix: "奈良", number_class: "480", number_hiragana: "り", number_numeric: "7890" },
  },
];

export default function PlatePreviewPage() {
  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-slate-900">ナンバープレート（SVGグリフ）</h1>
          <p className="text-xs text-slate-500 mt-1">
            左=標準（240px）/ 右=compact（100px）。グリフ未収録の文字はフォントに自動フォールバック。
          </p>
        </div>
        <div className="space-y-4">
          {SAMPLES.map(({ label, v }) => (
            <div key={v.id} className="rounded-lg bg-white p-4 shadow-sm">
              <p className="mb-2 text-[11px] font-medium text-slate-500">{label}</p>
              <div className="flex items-end gap-6">
                <div className="w-[240px]">
                  <VehiclePlate vehicle={v} />
                </div>
                <div className="w-[100px]">
                  <VehiclePlate vehicle={v} compact />
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">
          素材: public/number_plate（283.4646四方キャンバス）。メタデータ再生成:
          <code className="ml-1 rounded bg-slate-200 px-1">npx tsx src/scripts/generate-plate-glyphs.ts</code>
        </p>
      </div>
    </div>
  );
}
