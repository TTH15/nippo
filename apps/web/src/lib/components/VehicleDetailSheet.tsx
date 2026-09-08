"use client";

// ============================================================
// ナンバープレートを長押しすると、その車の詳細（整備情報と最後の記録）を出す。
//
// 運営は地図以外の画面（シフト表・車両一覧・日報・記録報告）でも「この車、
// オイルは？車検は？いま誰が乗ってる？」を知りたい。画面ごとに出し分けると
// ばらつくので、プレートを長押しするという1つの操作に寄せる（2026-09-08 ユーザー依頼）。
//
// 仕組み:
//   - 運営のレイアウトにこの Provider を置く。ドライバー側の画面には置かないので、
//     同じ VehiclePlate を使っていても長押しは効かない（見せる範囲を配置で決める）。
//   - タッチの長押しだけを見る（PC のマウスは当面なし・ユーザー判断 2026-09-08）。
//   - 対象は document 側で拾う。シフト表のプレートは pointer-events-none で親が
//     クリックを持つため、プレート自身にハンドラを付けても届かない。
//     祖先の [data-vehicle-plate-id] を辿る方式なら、囲いに属性を足すだけで済む。
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { apiFetch } from "@/lib/api";
import { VehicleDetailCard, type VehicleDetail } from "@/lib/components/VehicleDetailCard";
import { useModalKeys } from "@/lib/ui/dialog";

/** 長押しと見なす時間。短いと普通のタップで開いてしまい、長いと待たされる */
const LONG_PRESS_MS = 500;
/** この距離を超えて動いたらスクロール・ドラッグと見なして中止する */
const MOVE_TOLERANCE_PX = 10;

type Ctx = { open: (vehicleId: string) => void };
const VehicleDetailContext = createContext<Ctx | null>(null);

/** 画面側から明示的に開きたいとき用。Provider が無ければ null */
export function useVehicleDetail(): Ctx | null {
  return useContext(VehicleDetailContext);
}

export function VehicleDetailProvider({ children }: { children: ReactNode }) {
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const open = useCallback((id: string) => {
    setVehicleId(id);
    setDetail(null);
    setError("");
  }, []);
  const close = useCallback(() => setVehicleId(null), []);
  useModalKeys(vehicleId != null, close, panelRef);

  // 詳細の取得。開くたびに引き直す（整備情報は他の画面で更新されうる）
  useEffect(() => {
    if (!vehicleId) return;
    let alive = true;
    (async () => {
      try {
        // apiFetch は JSON を返し、2xx 以外は throw する
        const json = (await apiFetch(`/api/admin/vehicles/${vehicleId}/detail`)) as { vehicle: VehicleDetail };
        if (alive) setDetail(json.vehicle);
      } catch (e) {
        if (!alive) return;
        const message = e instanceof Error ? e.message : "";
        setError(/not found|404/i.test(message) ? "この車両は見つかりませんでした" : "詳細を読み込めませんでした");
      }
    })();
    return () => {
      alive = false;
    };
  }, [vehicleId]);

  // タッチの長押しを document で拾う
  useEffect(() => {
    let timer: number | null = null;
    let startX = 0;
    let startY = 0;
    let firedAt = 0;

    const cancel = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return; // PC のマウスは対象外
      const host = (e.target as HTMLElement | null)?.closest?.("[data-vehicle-plate-id]");
      const id = host?.getAttribute("data-vehicle-plate-id");
      if (!id) return;
      startX = e.clientX;
      startY = e.clientY;
      cancel();
      timer = window.setTimeout(() => {
        timer = null;
        firedAt = Date.now();
        // 触覚があると「開いた」と分かる（対応端末のみ）
        navigator.vibrate?.(15);
        open(id);
      }, LONG_PRESS_MS);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (timer === null) return;
      if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE_PX || Math.abs(e.clientY - startY) > MOVE_TOLERANCE_PX) {
        cancel();
      }
    };

    // 長押しで開いた直後の click は、下の割り当て・選択を誤爆させないよう飲み込む
    const onClick = (e: MouseEvent) => {
      if (firedAt && Date.now() - firedAt < 700) {
        e.stopPropagation();
        e.preventDefault();
        firedAt = 0;
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", cancel, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("scroll", cancel, true);
    document.addEventListener("click", onClick, true);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", cancel, true);
      document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("scroll", cancel, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [open]);

  return (
    <VehicleDetailContext.Provider value={{ open }}>
      {children}
      {vehicleId && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={close}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="車両の詳細"
            tabIndex={-1}
            className="w-full max-w-sm rounded-t-2xl bg-white p-4 shadow-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <span className="text-xs font-bold text-slate-500">車両の詳細</span>
              <button
                type="button"
                onClick={close}
                aria-label="閉じる"
                className="-m-1 p-1 text-slate-400 hover:text-slate-600"
              >
                <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
              </button>
            </div>
            {error ? (
              <p className="py-6 text-center text-sm text-slate-500">{error}</p>
            ) : detail ? (
              <VehicleDetailCard vehicle={detail} className="w-full" />
            ) : (
              <p className="py-6 text-center text-sm text-slate-400">読み込んでいます…</p>
            )}
          </div>
        </div>
      )}
    </VehicleDetailContext.Provider>
  );
}
