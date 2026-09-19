"use client";
import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCamera, faXmark } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { CheckboxField } from "@/lib/components/CheckboxField";
import { DatePicker } from "@/lib/components/DatePicker";
import { ImageLightbox } from "@/lib/components/ImageLightbox";
import { SmoothCollapse } from "@/lib/components/SmoothCollapse";
import { CERTIFICATE_FIELDS, selectedCertificatePatch, type CertificateField, type VehicleCertificateDraft } from "@/lib/ocr/vehicleCertificate";
import { CertificateReadError, readVehicleCertificate, type CertificateReadResult } from "@/lib/ocr/readVehicleCertificate";

export function VehicleCertificateReader({ current, vehicleId, onApply }: {
  current: VehicleCertificateDraft; vehicleId?: string; onApply: (patch: Partial<VehicleCertificateDraft>) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [result, setResult] = useState<CertificateReadResult | null>(null);
  const [selected, setSelected] = useState<CertificateField[]>([]);
  const [reading, setReading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);
  const cancel = () => {
    generation.current++; controller.current?.abort(); setReading(false); setResult(null); setError(""); setExpanded(false); setZoom(false); setChecking(false);
  };
  const read = async (file: File) => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const run = ++generation.current;
    setReading(true); setResult(null); setError(""); setProgress(0); setExpanded(true);
    const timeout = window.setTimeout(() => { abort.abort(); }, 120_000);
    try {
      const value = await readVehicleCertificate(file, { signal: abort.signal, onProgress: setProgress });
      if (generation.current !== run) return;
      setResult(value);
      setSelected((Object.keys(CERTIFICATE_FIELDS) as CertificateField[]).filter(k => value.draft[k]));
      if (!Object.values(value.draft).some(Boolean)) setError("項目を読み取れませんでした。文字が鮮明に写るよう撮り直すか、下の欄に入力してください。");
    } catch (e) {
      if (generation.current !== run) return;
      setError(abort.signal.aborted ? "読み取りに時間がかかっています。撮り直すか、手入力してください。" : e instanceof CertificateReadError ? e.message : "読み取れませんでした。写真を選び直すか、手入力してください。");
    } finally { window.clearTimeout(timeout); if (generation.current === run) setReading(false); }
  };
  const apply = async () => {
    if (!result) return;
    const patch = selectedCertificatePatch(result.draft, selected);
    const merged = { ...current, ...patch };
    const run = generation.current;
    setChecking(true); setError("");
    try {
      if ([merged.numberPrefix, merged.numberClass, merged.numberHiragana, merged.numberNumeric].every(Boolean)) {
        const query = new URLSearchParams({ numberPrefix: merged.numberPrefix, numberClass: merged.numberClass, numberHiragana: merged.numberHiragana, numberNumeric: merged.numberNumeric });
        const matches = await apiFetch<{ vehicles: { id: string }[] }>(`/api/admin/vehicles/check-number?${query}`);
        if (generation.current !== run) return;
        if (matches.vehicles.some(v => v.id !== vehicleId)) {
          setError("このナンバーは登録済みです。番号を確認するか、登録済みの車両を開いて読み取ってください。"); return;
        }
      }
      if (generation.current !== run) return;
      onApply(patch); cancel();
    } catch { if (generation.current === run) setError("登録済みの車両を確認できませんでした。もう一度お試しください。"); }
    finally { if (generation.current === run) setChecking(false); }
  };
  const displayValue = (key: CertificateField, value: string) => key === "nextShakenDate" && value ? format(new Date(`${value}T12:00:00`), "yyyy/MM/dd（eee）", { locale: ja }) : value;
  return <section aria-label="車検証から入力" className="rounded-lg border border-slate-200">
    <div className="flex flex-wrap items-center justify-between px-3 py-1">
      <button type="button" disabled={reading || checking} onClick={() => input.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded text-sm font-medium text-slate-700 disabled:opacity-50">
        <FontAwesomeIcon icon={faCamera} />{result ? "写真・PDFを選び直す" : "車検証を読み取る"}
      </button>
      {process.env.NEXT_PUBLIC_VEHICLE_READER_DEMO === "true" && <div className="ml-auto flex items-center gap-2">
        {[
          { file: "table.png", label: "写真例", aria: "架空の車検証写真で試す" },
          { file: "table.pdf", label: "PDF例", aria: "架空の車検証PDFで試す" },
          { file: "broken.pdf", label: "失敗例", aria: "車検証の読取失敗を試す" },
        ].map(sample => <button key={sample.file} type="button" disabled={reading || checking} aria-label={sample.aria} className="min-h-11 text-xs text-slate-500 underline" onClick={() => { void (async () => {
          try { const r = await fetch(`/reader-samples/${sample.file}`); if (!r.ok) throw new Error(); const blob = await r.blob(); await read(new File([blob], sample.file, { type: sample.file.endsWith(".png") ? "image/png" : "application/pdf" })); }
          catch { setError("サンプルを開けませんでした。"); setExpanded(true); }
        })(); }}>{sample.label}</button>)}
      </div>}
      {expanded && <button aria-label="車検証の読み取りを閉じる" type="button" onClick={cancel} className="h-11 w-11 rounded text-slate-500"><FontAwesomeIcon icon={faXmark} /></button>}
    </div>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" aria-label="車検証の写真またはPDF" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); }} />
    <SmoothCollapse open={expanded}>
      <div className="space-y-3 border-t border-slate-100 p-3">
        {reading && <div className="flex items-center justify-between gap-2" role="status"><span className="text-sm text-slate-600">{progress ? `読み取り中 ${progress}%` : "読み取りを準備しています…"}</span><button type="button" onClick={cancel} className="min-h-11 rounded px-3 text-sm underline">中止</button></div>}
        {error && <p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
        {result && <>
          <p className="text-sm text-slate-600">書類と見比べ、反映する項目を選んでください。</p>
          {result.pages > 1 && <p className="text-xs text-slate-500">先頭ページを読み取りました。必要な車両の書類か確認してください。</p>}
          <button type="button" onClick={() => setZoom(true)} className="block w-full rounded border border-slate-200 bg-slate-50 p-2" aria-label="車検証を拡大する">
            {/* 読取専用の端末内画像。車両の公開写真には保存しない。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.preview} alt="読み取った車検証" className="max-h-40 w-full object-contain" />
            <span className="text-xs text-slate-500">タップで拡大</span>
          </button>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(CERTIFICATE_FIELDS) as CertificateField[]).map(key => <div key={key} className="min-w-0 rounded border border-slate-200 p-2">
              <CheckboxField label={`${CERTIFICATE_FIELDS[key]}を反映`} checked={selected.includes(key)} disabled={checking} onCheckedChange={checked => setSelected(keys => checked ? [...keys, key] : keys.filter(k => k !== key))} />
              {key === "nextShakenDate" ? <DatePicker ariaLabel="読み取った車検満了日" value={result.draft[key] ? new Date(`${result.draft[key]}T12:00:00`) : undefined} disabled={checking} onChange={date => { setResult(r => r && ({ ...r, draft: { ...r.draft, [key]: date ? format(date, "yyyy-MM-dd") : "" } })); if (date) setSelected(keys => [...new Set([...keys, key])]); }} /> :
                <input aria-label={`読み取った${CERTIFICATE_FIELDS[key]}`} value={result.draft[key]} disabled={checking} maxLength={key === "modelCode" ? 30 : 40} onChange={e => { const value = e.target.value; setResult(r => r && ({ ...r, draft: { ...r.draft, [key]: value } })); if (value) setSelected(keys => [...new Set([...keys, key])]); }} placeholder="確認して入力" className="min-h-11 w-full rounded border border-slate-200 px-3 py-2 text-sm" />}
              {current[key] && current[key] !== result.draft[key] && <p className="mt-1 break-words text-xs text-slate-500">現在：{displayValue(key, current[key])}</p>}
            </div>)}
          </div>
          <div className="flex justify-end"><button type="button" onClick={() => void apply()} disabled={checking || !selected.some(k => result.draft[k].trim())} className="min-h-11 rounded bg-slate-800 px-4 text-sm text-white disabled:opacity-50">{checking ? "確認中…" : "選んだ項目を反映"}</button></div>
        </>}
      </div>
    </SmoothCollapse>
    {zoom && result && <ImageLightbox src={result.preview} alt="車検証の確認" onClose={() => setZoom(false)} />}
  </section>;
}
