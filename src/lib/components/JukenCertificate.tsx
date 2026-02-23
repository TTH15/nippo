"use client";

import { useRef } from "react";
import html2canvas from "html2canvas";

export type JukenNumbers = {
  takuhaibinMochidashi: number;
  takuhaibinHaikan: number;
  takuhaibinModori: number;
  takuhaibinHaikanModori: number;
  nekoposMochidashi: number;
  nekoposHaikan: number;
  nekoposModori: number;
  nekoposHaikanModori: number;
  totalMochidashi: number;
  totalHaikan: number;
  totalModori: number;
  totalHaikanModori: number;
};

// 位置調整用（親要素に対する相対位置 %）
const POSITIONS: Record<keyof JukenNumbers, { top: string; left: string }> = {
  takuhaibinMochidashi: { top: "28%", left: "12%" },
  takuhaibinHaikan: { top: "28%", left: "32%" },
  takuhaibinModori: { top: "28%", left: "52%" },
  takuhaibinHaikanModori: { top: "28%", left: "72%" },
  nekoposMochidashi: { top: "45%", left: "12%" },
  nekoposHaikan: { top: "45%", left: "32%" },
  nekoposModori: { top: "45%", left: "52%" },
  nekoposHaikanModori: { top: "45%", left: "72%" },
  totalMochidashi: { top: "62%", left: "12%" },
  totalHaikan: { top: "62%", left: "32%" },
  totalModori: { top: "62%", left: "52%" },
  totalHaikanModori: { top: "62%", left: "72%" },
};

export function JukenCertificate({ numbers, className }: { numbers: JukenNumbers; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const downloadJpg = async () => {
    if (!ref.current) return;
    const canvas = await html2canvas(ref.current, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
    );
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `配達受託者控_${new Date().toISOString().slice(0, 10)}.jpg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={className}>
      <div
        ref={ref}
        className="relative bg-[#fafaf8] border border-slate-300 overflow-hidden"
        style={{ width: 600, height: 420 }}
      >
        {/* 背景: /image/juken_certificate.png があれば使用（PDFをPNGにエクスポートして配置） */}
        <div
          className="absolute inset-0 bg-no-repeat bg-contain bg-center"
          style={{
            backgroundImage: "url(/image/juken_certificate.png)",
          }}
        />
        {/* 12個の数字オーバーレイ（位置はPOSITIONSで調整可能） */}
        {(Object.keys(POSITIONS) as (keyof JukenNumbers)[]).map((key) => (
          <div
            key={key}
            className="absolute text-xl font-bold text-slate-900 tabular-nums"
            style={{
              top: POSITIONS[key].top,
              left: POSITIONS[key].left,
              transform: "translate(-50%, -50%)",
            }}
          >
            {numbers[key]}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={downloadJpg}
        className="mt-3 w-full py-2.5 text-sm font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
      >
        JPGでダウンロード
      </button>
    </div>
  );
}
