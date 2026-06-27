"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faRotate,
  faDownload,
  faCircleCheck,
  faTriangleExclamation,
  faImage,
} from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { ConfirmDialog } from "@/lib/components/ConfirmDialog";
import { Button } from "@/lib/ui/button";

type QrInfo = {
  token: string;
  payload: string;
  version: number;
  status: "issued" | "active";
  issuedAt?: string | null;
  attachedConfirmedAt?: string | null;
};

type VehicleLite = {
  id: string;
  manufacturer?: string | null;
  brand?: string | null;
  number_prefix?: string | null;
  number_class?: string | null;
  number_hiragana?: string | null;
  number_numeric?: string | null;
};

function plateText(v: VehicleLite): string {
  return [v.number_prefix, v.number_class, v.number_hiragana, v.number_numeric].filter(Boolean).join(" ");
}

export function VehicleQrModal({
  vehicle,
  orgName,
  onClose,
}: {
  vehicle: VehicleLite;
  orgName?: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [qr, setQr] = useState<QrInfo | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReissue, setConfirmReissue] = useState<{ message: string } | null>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const vehicleName = [vehicle.manufacturer, vehicle.brand].filter(Boolean).join(" ") || "車両";
  const plate = plateText(vehicle);

  // 開いた時点で get-or-create（冪等）。既存があれば再生成せずそのまま使う。
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ qr: QrInfo | null }>(`/api/admin/vehicles/${vehicle.id}/qr`, {
        method: "POST",
        body: JSON.stringify({ ensure: true }),
      });
      setQr(res.qr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "QRの準備に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [vehicle.id]);

  useEffect(() => {
    load();
  }, [load]);

  // QR 画像（dataURL）生成
  useEffect(() => {
    if (!qr) {
      setDataUrl(null);
      return;
    }
    QRCode.toDataURL(qr.payload, { width: 320, margin: 1, errorCorrectionLevel: "M" })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [qr]);

  async function issue(confirm: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{
        requiresConfirm?: boolean;
        message?: string;
        qr?: QrInfo;
      }>(`/api/admin/vehicles/${vehicle.id}/qr`, {
        method: "POST",
        body: JSON.stringify({ confirm }),
      });
      if (res.requiresConfirm) {
        setConfirmReissue({ message: res.message ?? "再発行すると現在のQRは失効します。続行しますか？" });
        return;
      }
      if (res.qr) setQr(res.qr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "発行に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  // 車番・会社名つきラベルを html2canvas で画像化（日本語フォント対応）
  async function renderLabelCanvas() {
    if (!labelRef.current) return null;
    const { default: html2canvas } = await import("html2canvas");
    return html2canvas(labelRef.current, { backgroundColor: "#ffffff", scale: 3 });
  }

  async function activate() {
    if (!qr) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/vehicle-qr/activate`, {
        method: "POST",
        body: JSON.stringify({ token: qr.token }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "有効化に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    const canvas = await renderLabelCanvas();
    if (!canvas) return;
    const { jsPDF } = await import("jspdf");
    const img = canvas.toDataURL("image/png");
    // A6 ラベル中央に配置
    const doc = new jsPDF({ unit: "mm", format: "a6", orientation: "portrait" });
    const pw = doc.internal.pageSize.getWidth();
    const margin = 8;
    const w = pw - margin * 2;
    const h = (canvas.height / canvas.width) * w;
    doc.addImage(img, "PNG", margin, margin, w, h);
    doc.save(`vehicle-qr-${plate || vehicle.id}.pdf`);
  }

  function downloadPng() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `vehicle-qr-${plate || vehicle.id}.png`;
    a.click();
  }

  const statusBadge = !qr ? (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-500">
      未発行
    </span>
  ) : qr.status === "active" ? (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700">
      <FontAwesomeIcon icon={faCircleCheck} className="w-3 h-3" />
      有効
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-700">
      <FontAwesomeIcon icon={faTriangleExclamation} className="w-3 h-3" />
      貼付確認待ち
    </span>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダ */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">車両QR</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {vehicleName}
              {plate ? ` ・ ${plate}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" title="閉じる">
            <FontAwesomeIcon icon={faXmark} className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-5">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-400">読み込み中…</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-slate-500">状態</span>
                <div className="flex items-center gap-2">
                  {qr && <span className="text-xs text-slate-400">v{qr.version}</span>}
                  {statusBadge}
                </div>
              </div>

              {/* QR ラベル（このまま画像化してPDF化する） */}
              {qr && dataUrl ? (
                <div className="flex justify-center mb-4">
                  <div
                    ref={labelRef}
                    className="bg-white border border-slate-200 rounded-lg p-4 w-[260px] text-center"
                  >
                    {orgName && <div className="text-xs text-slate-500 mb-1">{orgName}</div>}
                    <div className="text-sm font-semibold text-slate-800 mb-2">{vehicleName}</div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={dataUrl} alt="車両QR" width={200} height={200} className="mx-auto" />
                    {plate && <div className="text-sm font-medium text-slate-700 mt-2 tracking-wide">{plate}</div>}
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-lg mb-4">
                  まだQRが発行されていません
                </div>
              )}

              {/* 貼付確認の案内 */}
              {qr?.status === "issued" && (
                <div className="mb-4">
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-2">
                    車両に貼った後、<strong>有効化（貼付確認）</strong>してください。有効化するまでドライバーは出勤打刻できません。運営アプリでQRをスキャンするか、下のボタンで有効化できます。
                  </div>
                  <Button onClick={activate} disabled={busy}>
                    <FontAwesomeIcon icon={faCircleCheck} className="w-3.5 h-3.5 mr-1.5" />
                    貼付を確認して有効化
                  </Button>
                </div>
              )}
              {qr?.status === "active" && qr.attachedConfirmedAt && (
                <div className="text-xs text-green-700 mb-4">
                  有効化済み: {new Date(qr.attachedConfirmedAt).toLocaleString("ja-JP")}
                </div>
              )}

              {error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
                  {error}
                </div>
              )}

              {/* アクション（QRは開いた時点で自動作成済み。ここでの再発行は明示操作） */}
              {qr && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => issue(false)} disabled={busy}>
                    <FontAwesomeIcon icon={faRotate} className="w-3.5 h-3.5 mr-1.5" />
                    再発行
                  </Button>
                  {dataUrl && (
                    <>
                      <Button variant="secondary" onClick={downloadPdf} disabled={busy}>
                        <FontAwesomeIcon icon={faDownload} className="w-3.5 h-3.5 mr-1.5" />
                        ラベルPDF
                      </Button>
                      <Button variant="secondary" onClick={downloadPng} disabled={busy}>
                        <FontAwesomeIcon icon={faImage} className="w-3.5 h-3.5 mr-1.5" />
                        画像
                      </Button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmReissue}
        title="QRを再発行しますか？"
        message={confirmReissue?.message ?? ""}
        confirmLabel="再発行する"
        onConfirm={() => {
          setConfirmReissue(null);
          issue(true);
        }}
        onClose={() => setConfirmReissue(null)}
      />
    </div>
  );
}
