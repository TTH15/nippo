"use client";

import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

// ============================================================
// ガイド付き KYC 撮影（免許証の枠ガイド / 顔の輪郭ガイド）。
// getUserMedia でページ内カメラを開き、ガイドに合わせてその場で撮影する
// （ネイティブカメラ UI にはガイドを重ねられないため自前で描く）。
// - 免許証: カード比率(1.58:1)の白枠＋レイアウト線画。周囲は暗転
// - 顔: 卵型＋首・肩の点線ガイド
// - その場撮影限定（ギャラリー選択なし）。カメラが使えない環境
//   （非HTTPS・権限拒否・デスクトップ等）は <input capture> へフォールバック
// 撮影結果は File で返す＝既存の縮小→JPEG→アップロード経路をそのまま使う。
//
// TODO(スマホ実機で要調整・2026-07-26):
// - PC ではカメラが広角で、保存画像に対して免許証がごく一部にしか写らない。
//   対策候補: 撮影時にガイド枠相当の領域へクロップして保存する／
//   getUserMedia constraints の zoom・aspectRatio 指定。スマホの画角で要確認。
// - 顔ガイド（SVG）の表示サイズが PC では小さい。実機の画面比で w-[%] を追い込む。
// - 実機確認は HTTPS が必要（next dev --experimental-https か Vercel preview）。
// ============================================================

type Kind = "license" | "face";

const GUIDE_TEXT: Record<Kind, string> = {
  license: "枠に免許証を合わせて撮影してください",
  face: "枠に顔を合わせて撮影してください（帽子・マスクは外す）",
};

export function GuidedKycPhoto({
  kind,
  title,
  done,
  previewUri,
  busy,
  onPick,
}: {
  kind: Kind;
  title: string;
  done: boolean;
  previewUri?: string;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = () => {
    // ページ内カメラは HTTPS（または localhost）でのみ使える。不可ならネイティブカメラへ。
    const canUseCamera =
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
    if (canUseCamera) setCameraOpen(true);
    else inputRef.current?.click();
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={`w-full h-44 rounded-lg border flex items-center justify-center overflow-hidden ${
          done ? "border-emerald-500 bg-emerald-50" : "border-dashed border-slate-300 bg-slate-50"
        } disabled:opacity-60`}
      >
        {previewUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUri} alt="preview" className="w-full h-full object-cover" />
        ) : busy ? (
          <span className="text-sm text-slate-400">処理中...</span>
        ) : (
          <span className={`text-sm ${done ? "text-emerald-600 font-semibold" : "text-slate-400"}`}>
            {done ? "✓ 撮影済み（撮り直し可）" : "タップして撮影"}
          </span>
        )}
      </button>
      {/* フォールバック（カメラ起動不可の環境）。capture 指定でモバイルはカメラ直行 */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture={kind === "face" ? "user" : "environment"}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
      {cameraOpen && (
        <CameraModal
          kind={kind}
          onCapture={(f) => {
            setCameraOpen(false);
            onPick(f);
          }}
          onClose={() => setCameraOpen(false)}
          onFallback={() => {
            setCameraOpen(false);
            inputRef.current?.click();
          }}
        />
      )}
    </div>
  );
}

function CameraModal({
  kind,
  onCapture,
  onClose,
  onFallback,
}: {
  kind: Kind;
  onCapture: (f: File) => void;
  onClose: () => void;
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: kind === "face" ? "user" : "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.onloadedmetadata = () => setReady(true);
        }
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [kind]);

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], `${kind}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* カメラ映像（顔はミラー表示。保存画像は反転しない） */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={kind === "face" ? { transform: "scaleX(-1)" } : undefined}
        />
        {/* ガイド枠（周囲を暗転させる） */}
        {ready && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {kind === "license" ? (
              // カード枠＋レイアウトの線画スケルトン（文字なし・要素は最小限・太線＋角丸で柔らかく）。
              // 氏名行（＋右端に生年月日のピル）／住所2行の箱／有効期限の帯／
              // 左下の小さな連結段／種類の連結グリッド／写真枠＋人型シルエット。
              <div
                className="relative w-[86%] max-w-md aspect-[1.58/1] rounded-2xl border-[3px] border-white/90"
                style={{ boxShadow: "0 0 0 200vmax rgba(0,0,0,0.55)" }}
              >
                <svg
                  viewBox="0 0 316 200"
                  className="absolute inset-0 h-full w-full"
                  fill="none"
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {/* 氏名行＋生年月日（右端の短いピル） */}
                  <rect x="22" y="20" width="204" height="16" rx="8" />
                  <rect x="236" y="20" width="58" height="16" rx="8" />
                  {/* 住所（2行の箱） */}
                  <rect x="22" y="48" width="180" height="40" rx="8" />
                  <line x1="32" y1="68" x2="192" y2="68" strokeOpacity="0.7" />
                  {/* 有効期限の帯（塗りのみ） */}
                  <rect x="22" y="98" width="180" height="20" rx="7" fill="rgba(255,255,255,0.22)" stroke="none" />
                  {/* 左下の小さな連結段 */}
                  <rect x="22" y="130" width="52" height="44" rx="7" />
                  <line x1="30" y1="152" x2="66" y2="152" strokeOpacity="0.7" />
                  {/* 種類の連結グリッド（2段） */}
                  <rect x="88" y="138" width="114" height="36" rx="7" />
                  <line x1="96" y1="156" x2="194" y2="156" strokeOpacity="0.7" />
                  <line x1="111" y1="142" x2="111" y2="170" strokeOpacity="0.7" />
                  <line x1="134" y1="142" x2="134" y2="170" strokeOpacity="0.7" />
                  <line x1="157" y1="142" x2="157" y2="170" strokeOpacity="0.7" />
                  <line x1="180" y1="142" x2="180" y2="170" strokeOpacity="0.7" />
                  {/* 写真枠＋人型シルエット */}
                  <rect x="214" y="48" width="80" height="126" rx="8" />
                  <circle cx="254" cy="98" r="17" fill="rgba(255,255,255,0.9)" stroke="none" />
                  <path
                    d="M224 172 C227 138 239 120 254 120 C269 120 281 138 284 172 Z"
                    fill="rgba(255,255,255,0.9)"
                    stroke="none"
                  />
                </svg>
              </div>
            ) : (
              // 顔ガイド: 卵型（顎すぼまり）の点線＋中心十字＋首・肩のライン。
              // 参考: eKYC 系の定番ガイド。暗転はせず映像そのまま（顔の位置合わせ優先）。
              <svg viewBox="0 0 200 260" className="w-[78%] max-w-[320px]" fill="none">
                {/* 頭部（卵型） */}
                <path
                  d="M100 24 C138 24 159 56 156 92 C153 128 129 158 100 158 C71 158 47 128 44 92 C41 56 62 24 100 24 Z"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeDasharray="3 7"
                  strokeLinecap="round"
                />
                {/* 中心合わせの十字（縦=正中線・横=目の高さ） */}
                <line x1="100" y1="32" x2="100" y2="150" stroke="white" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="2 6" />
                <line x1="52" y1="92" x2="148" y2="92" stroke="white" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="2 6" />
                {/* 首 */}
                <path d="M83 153 C85 168 84 177 79 186" stroke="white" strokeWidth="2.5" strokeDasharray="3 7" strokeLinecap="round" />
                <path d="M117 153 C115 168 116 177 121 186" stroke="white" strokeWidth="2.5" strokeDasharray="3 7" strokeLinecap="round" />
                {/* 肩 */}
                <path d="M79 186 C54 192 30 206 20 238" stroke="white" strokeWidth="2.5" strokeDasharray="3 7" strokeLinecap="round" />
                <path d="M121 186 C146 192 170 206 180 238" stroke="white" strokeWidth="2.5" strokeDasharray="3 7" strokeLinecap="round" />
              </svg>
            )}
          </div>
        )}
        <p className="absolute top-6 inset-x-6 text-center text-white text-sm font-medium drop-shadow">
          {GUIDE_TEXT[kind]}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 h-10 w-10 rounded-full bg-black/50 text-white flex items-center justify-center"
          aria-label="閉じる"
        >
          <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
        </button>
        {failed && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-white text-sm">
              カメラを起動できませんでした。端末のカメラで撮影してください。
            </p>
            <button
              type="button"
              onClick={onFallback}
              className="py-2.5 px-6 rounded-lg bg-white text-slate-900 text-sm font-medium"
            >
              カメラで撮影する
            </button>
          </div>
        )}
      </div>
      {/* シャッター */}
      <div className="h-28 bg-black flex items-center justify-center">
        <button
          type="button"
          onClick={shoot}
          disabled={!ready || failed}
          className="h-16 w-16 rounded-full border-4 border-white bg-white/20 active:bg-white/50 disabled:opacity-30"
          aria-label="撮影"
        />
      </div>
    </div>
  );
}
