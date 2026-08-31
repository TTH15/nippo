"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight, faDownload, faShareNodes } from "@fortawesome/free-solid-svg-icons";
import { EditorModal } from "./EditorModal";
import type { DispatchImage } from "@/lib/captureDispatchImage";

const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-40";
export function ImageExportDialog({ title, filename, pageCount, generate, onClose, children }: {
  title: string; filename: string; pageCount: number;
  generate: (page: number) => Promise<DispatchImage>; onClose: () => void; children?: ReactNode;
}) {
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ image: DispatchImage; generate: typeof generate; page: number } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const currentPage = Math.min(page, pageCount - 1);
  // 条件変更直後に以前の画像を新しいファイル名で保存させない。
  const image = result?.generate === generate && result.page === currentPage ? result.image : null;
  const name = `${filename}${pageCount > 1 ? `_${currentPage + 1}` : ""}.png`;
  const file = useMemo(() => image ? new File([image.blob], name, { type: "image/png" }) : null, [image, name]);
  let canShare = false;
  try { canShare = Boolean(file && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })); } catch { /* 未対応端末は長押し・ダウンロードで保存する。 */ }
  useEffect(() => { setPage(0); }, [generate]);
  useEffect(() => {
    let cancelled = false;
    setError(""); setMessage("");
    generate(currentPage).then(image => { if (!cancelled) setResult({ image, generate, page: currentPage }); })
      .catch(() => { if (!cancelled) setError("画像を作成できませんでした。読み込み完了後、もう一度お試しください。"); });
    return () => { cancelled = true; };
  }, [generate, currentPage, retry]);
  const share = async () => {
    if (!file || !canShare || sharing) return;
    setSharing(true); setMessage("");
    try {
      // 画像生成後のクリックから直接呼び出し、ユーザー操作権限を失わない。
      await navigator.share({ files: [file] });
      setMessage("共有メニューを閉じました。保存先で画像をご確認ください。");
    } catch (cause) {
      setMessage(cause instanceof Error && cause.name === "AbortError" ? "共有をキャンセルしました。画像は引き続き保存できます。" : "共有メニューを開けませんでした。画像の長押し保存かダウンロードをお試しください。");
    } finally { setSharing(false); }
  };
  return <EditorModal title={title} variant="shift" onClose={onClose} footer={<>
    <div className="flex flex-wrap gap-2">
      {canShare && <button type="button" className={buttonClass + " !border-slate-800 !bg-slate-800 !text-white"} disabled={sharing} onClick={share}><FontAwesomeIcon icon={faShareNodes} />共有・写真に保存</button>}
      {image && <a className={buttonClass} href={image.url} download={name}><FontAwesomeIcon icon={faDownload} />画像をダウンロード</a>}
      <button type="button" className={buttonClass} onClick={onClose}>閉じる</button>
    </div>
    <p className="mt-2 text-[11px] leading-5 text-slate-500">{canShare ? "共有メニューに「画像を保存」がある場合は、そこから写真に保存できます。" : "画像を長押しして保存するか、ダウンロードしてください。"}写真への自動保存はできません。</p>
    {message && <p role="status" className="mt-2 text-xs text-slate-600">{message}</p>}
  </>}>
    <fieldset disabled={sharing}>{children}</fieldset>
    {pageCount > 1 && <div className="mt-3 flex items-center justify-between text-xs">
      <button type="button" aria-label="前の画像" className={buttonClass} disabled={currentPage === 0 || sharing} onClick={() => setPage(currentPage - 1)}><FontAwesomeIcon icon={faChevronLeft} /></button>
      <span>{currentPage + 1} / {pageCount}枚</span>
      <button type="button" aria-label="次の画像" className={buttonClass} disabled={currentPage === pageCount - 1 || sharing} onClick={() => setPage(currentPage + 1)}><FontAwesomeIcon icon={faChevronRight} /></button>
    </div>}
    {error ? <div className="my-4"><p role="alert" className="text-sm text-red-700">{error}</p><button type="button" className={buttonClass + " mt-2"} onClick={() => setRetry(value => value + 1)}>もう一度作成する</button></div> : image ? <div className="mt-4">
      {/* 長押し保存のためNext Imageを介さず実体PNGを表示する。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={`${title} ${currentPage + 1}枚目`} width={image.width} height={image.height} className="h-auto w-full rounded-lg border border-slate-200" />
    </div> : <p role="status" className="my-8 text-center text-sm text-slate-500">画像を作成しています…</p>}
  </EditorModal>;
}
