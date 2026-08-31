"use client";
import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDownload, faShareNodes, faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { DatePicker } from "@/lib/components/DatePicker";
import { DayFilterTabs } from "./DayFilterTabs";
import { countDayDrivers } from "./dayFilter";
import { DATES, filterDrivers, type Demo } from "./model";
import type { ShiftView } from "./navigation";
import { buildDayImageData, IMAGE_PAGE_SIZE, renderDayImage, type ImageArtifact } from "./shiftImage";
import { buttonClass, EditorModal, primaryClass } from "./ui";

export function ShiftExportDialog({ demo, view, date: initialDate, onClose }: { demo: Demo; view: ShiftView; date: string; onClose: () => void }) {
  const [date, setDate] = useState(initialDate);
  const [dayFilter, setDayFilter] = useState(view.dayFilter);
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [artifact, setArtifact] = useState<ImageArtifact | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const data = useMemo(() => buildDayImageData(demo, view, date, dayFilter), [demo, view, date, dayFilter]);
  const counts = countDayDrivers(demo, filterDrivers(demo, view.labelIds, view.mode, view.query), date);
  const pages = Math.ceil(data.rows.length / IMAGE_PAGE_SIZE);
  const filename = `dispatch_${date}_${dayFilter}${pages > 1 ? `_${page + 1}` : ""}.png`;
  const file = useMemo(() => artifact ? new File([artifact.blob], filename, { type: "image/png" }) : null, [artifact, filename]);
  let canShare = false;
  try { canShare = Boolean(file && typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })); } catch { /* 未対応のWebViewでは保存へ案内する。 */ }
  useEffect(() => {
    let cancelled = false;
    setArtifact(null); setError(""); setMessage("");
    if (data.rows.length) renderDayImage(data, page).then(result => { if (!cancelled) setArtifact(result); }).catch(() => { if (!cancelled) setError("画像を作成できませんでした。プレート素材の読み込みを確認して、もう一度お試しください。"); });
    return () => { cancelled = true; };
  }, [data, page, retry]);
  const share = async () => {
    if (!file || !canShare || sharing) return;
    setSharing(true); setMessage("");
    try {
      // 画像は先に生成しておき、クリック直後のユーザー操作権限で共有シートを開く。
      await navigator.share({ files: [file] });
      setMessage("共有メニューを閉じました。保存先で画像をご確認ください。");
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") setMessage("共有をキャンセルしました。画像はこのまま保存できます。");
      else setMessage("共有メニューを開けませんでした。画像の長押し保存またはダウンロードをお試しください。");
    } finally { setSharing(false); }
  };
  return <EditorModal title="日別配車を画像にする" variant="shift" onClose={onClose} footer={<>
    <div className="flex flex-wrap gap-2">
      {canShare && <button className={primaryClass} disabled={sharing} onClick={share}><FontAwesomeIcon icon={faShareNodes}/>{sharing ? "共有メニューを表示中" : "共有・写真に保存"}</button>}
      {artifact && <a className={canShare ? buttonClass : primaryClass} href={artifact.url} download={filename}><FontAwesomeIcon icon={faDownload}/>画像をダウンロード</a>}
      <button className={buttonClass} onClick={onClose}>閉じる</button>
    </div>
    <p className="mt-2 text-[11px] leading-5 text-slate-500">{!artifact ? "画像を作成すると、共有・保存方法を表示します。" : canShare ? "共有メニューに「画像を保存」がある場合は、そこから写真に保存できます。" : "共有メニュー非対応のブラウザです。画像を長押しして保存するか、ダウンロードしてください。"} 写真への自動保存はできません。</p>
    {message && <p role="status" className="mt-2 text-xs text-slate-600">{message}</p>}
  </>}>
    <div className="mb-2 flex items-center gap-3"><div className="min-w-0 flex-1"><DatePicker ariaLabel="画像にする日付" value={new Date(date + "T12:00:00")} displayFormat="yyyy/M/d（E）" fromDate={new Date(DATES[0] + "T12:00:00")} toDate={new Date(DATES[DATES.length - 1] + "T12:00:00")} disabled={sharing} onChange={value => { if (value) { setArtifact(null); setPage(0); setDate(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`); } }}/></div><span className="shrink-0 text-sm">{data.rows.length}人</span></div>
    <p className="mb-3 text-xs leading-5 text-slate-500">現在のラベル・契約・名前の絞り込みと表示項目を反映します。画像の生成は端末内で行います。</p>
    <DayFilterTabs value={dayFilter} counts={counts} disabled={sharing} onChange={value => { setArtifact(null); setPage(0); setDayFilter(value); }}/>
    {pages > 1 && <div className="mt-3 flex items-center justify-between text-xs"><button aria-label="前の画像" className={buttonClass} disabled={page === 0 || sharing} onClick={() => { setArtifact(null); setPage(page - 1); }}><FontAwesomeIcon icon={faChevronLeft}/></button><span>{page + 1} / {pages}枚（最大{IMAGE_PAGE_SIZE}人ずつ）</span><button aria-label="次の画像" className={buttonClass} disabled={page === pages - 1 || sharing} onClick={() => { setArtifact(null); setPage(page + 1); }}><FontAwesomeIcon icon={faChevronRight}/></button></div>}
    {!data.rows.length ? <p role="status" className="my-6 text-sm text-slate-500">画像にするドライバーがいません。絞り込みを変更してください。</p> : error ? <div className="my-5"><p role="alert" className="text-sm text-red-700">{error}</p><button className={buttonClass + " mt-3"} onClick={() => setRetry(value => value + 1)}>もう一度作成する</button></div> : artifact ? <div className="mt-4">
      {/* 保存・長押し操作用の実体PNG。Next Imageの最適化を介さない。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={artifact.url} alt={`${date}の日別配車画像 ${page + 1}枚目`} width={artifact.width} height={artifact.height} className="h-auto w-full rounded-lg border border-slate-200"/>
      <p className="mt-2 text-center text-[11px] text-slate-500">PNG · {artifact.width} × {artifact.height}px · 架空データ</p>
    </div> : <p role="status" className="my-8 text-center text-sm text-slate-500">画像を作成しています…</p>}
  </EditorModal>;
}
