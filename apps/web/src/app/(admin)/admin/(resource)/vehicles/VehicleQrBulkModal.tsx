"use client";

import { useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faDownload } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { Button } from "@/lib/ui/button";

type VehicleLite = {
  id: string;
  manufacturer?: string | null;
  brand?: string | null;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
};

type BulkItem = {
  vehicleId: string;
  token: string;
  payload: string;
  version: number;
  status: string;
  manufacturer: string | null;
  brand: string | null;
  numberPrefix: string | null;
  numberClass: string | null;
  numberHiragana: string | null;
  numberNumeric: string | null;
};

function plateOf(v: {
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
}): string {
  return [v.number_prefix, v.number_class, v.number_hiragana, v.number_numeric].filter(Boolean).join(" ");
}

function itemPlate(it: BulkItem): string {
  return [it.numberPrefix, it.numberClass, it.numberHiragana, it.numberNumeric].filter(Boolean).join(" ");
}

export function VehicleQrBulkModal({
  vehicles,
  orgName,
  onClose,
}: {
  vehicles: VehicleLite[];
  orgName?: string;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(vehicles.map((v) => v.id)));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<BulkItem[]>([]);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const sheetRef = useRef<HTMLDivElement>(null);

  const allChecked = selected.size === vehicles.length && vehicles.length > 0;
  const selectedCount = selected.size;

  const sortedVehicles = useMemo(
    () => [...vehicles].sort((a, b) => plateOf(a).localeCompare(plateOf(b), "ja")),
    [vehicles],
  );

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(vehicles.map((v) => v.id)));
  }

  async function handleDownload() {
    if (selectedCount === 0) return;
    setGenerating(true);
    setError(null);
    try {
      // 1) 選択車両のQRを get-or-create（既存は再生成しない）
      const res = await apiFetch<{ items: BulkItem[] }>("/api/admin/vehicle-qr/bulk", {
        method: "POST",
        body: JSON.stringify({ vehicleIds: Array.from(selected) }),
      });
      const its = res.items ?? [];
      if (its.length === 0) {
        setError("対象の車両がありません。");
        return;
      }

      // 2) QR画像を生成
      const map: Record<string, string> = {};
      await Promise.all(
        its.map(async (it) => {
          map[it.vehicleId] = await QRCode.toDataURL(it.payload, {
            width: 320,
            margin: 1,
            errorCorrectionLevel: "M",
          });
        }),
      );
      setItems(its);
      setQrMap(map);

      // 3) DOM 反映を待ってからラベルを画像化→PDF
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      await buildPdf(its.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ダウンロードに失敗しました");
    } finally {
      setGenerating(false);
    }
  }

  async function buildPdf(count: number) {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const { jsPDF } = await import("jspdf");
    const { default: html2canvas } = await import("html2canvas");

    const labels = Array.from(sheet.querySelectorAll<HTMLElement>(".qr-label"));
    if (labels.length === 0) return;

    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const cols = 3;
    const rowsPerPage = 3;
    const perPage = cols * rowsPerPage;
    const mx = 10;
    const my = 12;
    const gx = 5;
    const gy = 6;
    const lw = (210 - mx * 2 - gx * (cols - 1)) / cols; // ≒ 60mm

    for (let i = 0; i < labels.length; i++) {
      const canvas = await html2canvas(labels[i], { backgroundColor: "#ffffff", scale: 2 });
      const idxInPage = i % perPage;
      if (i > 0 && idxInPage === 0) doc.addPage();
      const c = idxInPage % cols;
      const r = Math.floor(idxInPage / cols);
      const x = mx + c * (lw + gx);
      const y = my + r * ((canvas.height / canvas.width) * lw + gy);
      const h = (canvas.height / canvas.width) * lw;
      doc.addImage(canvas.toDataURL("image/png"), "PNG", x, y, lw, h);
    }
    doc.save(`vehicle-qr-labels-${count}.pdf`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">車両QR 一括ダウンロード</h2>
            <p className="text-xs text-slate-500 mt-0.5">選択した車両のQRラベルをPDFでまとめて出力します</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" title="閉じる">
            <FontAwesomeIcon icon={faXmark} className="w-5 h-5" />
          </button>
        </div>

        {/* チェックリスト */}
        <div className="px-5 py-3 border-b border-slate-100">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
            <input type="checkbox" checked={allChecked} onChange={toggleAll} className="w-4 h-4" />
            すべて選択（{selectedCount}/{vehicles.length}）
          </label>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {sortedVehicles.map((v) => {
            const name = [v.manufacturer, v.brand].filter(Boolean).join(" ") || "車両";
            const plate = plateOf(v) || "（番号未設定）";
            return (
              <label
                key={v.id}
                className="flex items-center gap-3 py-2 border-b border-slate-50 cursor-pointer hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(v.id)}
                  onChange={() => toggle(v.id)}
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium text-slate-800">{plate}</span>
                <span className="text-xs text-slate-400">{name}</span>
              </label>
            );
          })}
        </div>

        {error && (
          <div className="px-5 py-2 text-xs text-red-600 bg-red-50 border-t border-red-100">{error}</div>
        )}

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={generating}>
            閉じる
          </Button>
          <Button onClick={handleDownload} disabled={generating || selectedCount === 0}>
            <FontAwesomeIcon icon={faDownload} className="w-3.5 h-3.5 mr-1.5" />
            {generating ? "生成中…" : `${selectedCount}台をPDF`}
          </Button>
        </div>
      </div>

      {/* 画像化用の隠しラベルシート（画面外） */}
      <div ref={sheetRef} style={{ position: "fixed", left: -99999, top: 0 }} aria-hidden>
        {items.map((it) => (
          <div
            key={it.vehicleId}
            className="qr-label"
            style={{
              width: 240,
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: 16,
              textAlign: "center",
            }}
          >
            {orgName && <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{orgName}</div>}
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 8 }}>
              {[it.manufacturer, it.brand].filter(Boolean).join(" ") || "車両"}
            </div>
            {qrMap[it.vehicleId] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrMap[it.vehicleId]} alt="" width={200} height={200} style={{ margin: "0 auto" }} />
            )}
            <div style={{ fontSize: 14, fontWeight: 500, color: "#334155", marginTop: 8, letterSpacing: 1 }}>
              {itemPlate(it)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
