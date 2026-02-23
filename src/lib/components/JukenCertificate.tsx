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

/** 日付の相対位置（親要素に対する %） */
export type DatePosition = {
  top: string;
  left: string;
};

/** 画像に被せるテキスト（右上: 事業所コード・個人番号・氏名、左上: 日付） */
export type JukenOverlay = {
  /** 事業所コード */
  officeCode: string;
  /** 個人番号（ドライバーコードの数字6桁のみ） */
  personalNumber: string;
  /** 氏名 */
  name: string;
  /** 日付（西暦・月・日の数値） */
  date: { year: number; month: number; day: number };
  /** 年月日の各表示位置（省略時はデフォルト位置） */
  datePositions?: {
    year: DatePosition;
    month: DatePosition;
    day: DatePosition;
  };
};

// 位置調整用（親要素に対する相対位置 %）
const POSITIONS: Record<keyof JukenNumbers, { top: string; left: string }> = {
  takuhaibinMochidashi: { top: "44.5%", left: "54%" },
  takuhaibinHaikan: { top: "44.5%", left: "78%" },
  takuhaibinModori: { top: "44.5%", left: "84%" },
  takuhaibinHaikanModori: { top: "44.5%", left: "91%" },
  nekoposMochidashi: { top: "51%", left: "54%" },
  nekoposHaikan: { top: "51%", left: "78%" },
  nekoposModori: { top: "51%", left: "84%" },
  nekoposHaikanModori: { top: "51%", left: "91%" },
  totalMochidashi: { top: "77.5%", left: "54%" },
  totalHaikan: { top: "77.5%", left: "78%" },
  totalModori: { top: "77.5%", left: "84%" },
  totalHaikanModori: { top: "77.5%", left: "91%" },
};

export function JukenCertificate({
  numbers,
  overlay,
  className,
  hideDownloadButton,
  /** 親がキャプチャ用に参照したい場合に渡す（証明書のルート要素が渡る） */
  certificateRef,
}: {
  numbers: JukenNumbers;
  overlay?: JukenOverlay;
  className?: string;
  hideDownloadButton?: boolean;
  certificateRef?: (el: HTMLDivElement | null) => void;
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);

  const setRef = (el: HTMLDivElement | null) => {
    (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    certificateRef?.(el);
  };

  const downloadImage = async () => {
    if (!innerRef.current) return;
    const canvas = await html2canvas(innerRef.current, {
      scale: 3,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png")
    );
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `配達受託者控_${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={className}>
      <div
        ref={setRef}
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
        {/* 左上: 日付（西暦・月・日を相対位置で配置） */}
        {overlay && (() => {
          const pos = overlay.datePositions ?? {
            year: { top: "23%", left: "26%" },
            month: { top: "23%", left: "37%" },
            day: { top: "23%", left: "42.5%" },
          };
          const { year, month, day } = overlay.date;
          return (
            <>
              <span
                className="absolute text-sm font-bold text-slate-900 tabular-nums"
                style={{ top: pos.year.top, left: pos.year.left }}
              >
                {year}
              </span>
              <span
                className="absolute text-sm font-bold text-slate-900 tabular-nums"
                style={{ top: pos.month.top, left: pos.month.left }}
              >
                {month}
              </span>
              <span
                className="absolute text-sm font-bold text-slate-900 tabular-nums"
                style={{ top: pos.day.top, left: pos.day.left }}
              >
                {day}
              </span>
            </>
          );
        })()}
        {/* 右上: 事業所コード、個人番号（6桁）、氏名 */}
        {overlay && (
          <div
            className="absolute text-right text-sm font-bold text-slate-900 tabular-nums"
            style={{ top: "11%", right: "18%", lineHeight: 1.7 }}
          >
            <div>{overlay.officeCode}</div>
            <div>{overlay.personalNumber}</div>
            <div>{overlay.name}</div>
          </div>
        )}
        {/* 12個の数字オーバーレイ（位置はPOSITIONSで調整可能） */}
        {(Object.keys(POSITIONS) as (keyof JukenNumbers)[]).map((key) => (
          <div
            key={key}
            className="absolute text-l font-bold text-slate-900 tabular-nums"
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
      {!hideDownloadButton && (
        <button
          type="button"
onClick={downloadImage}
        className="mt-3 w-full py-2.5 text-sm font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
      >
        PNGでダウンロード
        </button>
      )}
    </div>
  );
}
