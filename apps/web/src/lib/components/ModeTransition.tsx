"use client";

// 運営⇄ドライバーのモード切替演出。
// FAB の押下点から行き先モードの背景色のインクが円形に広がり、
// 画面を覆い切ったところでルート遷移 → 新画面の描画を確認してフェードアウトする。
// ルートグループ((admin)/(user))をまたいで遷移してもオーバーレイが
// アンマウントされないよう、Provider は root layout に置く。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

type InkOptions = {
  /** 押下点（ビューポート座標）。ここを中心にインクが広がる */
  x: number;
  y: number;
  /** 行き先モードの背景色。広がり切った円がそのまま新画面の背景になじむ */
  color: string;
  /** 遷移先ルート */
  href: string;
};

type ModeTransitionContextValue = {
  switchMode: (options: InkOptions) => void;
};

const ModeTransitionContext = createContext<ModeTransitionContextValue | null>(null);

export function useModeTransition() {
  const ctx = useContext(ModeTransitionContext);
  if (!ctx) {
    throw new Error("useModeTransition は ModeTransitionProvider の内側で使用する");
  }
  return ctx;
}

const EXPAND_MS = 480;
const FADE_MS = 320;
/** 遷移先の描画確認を待つ上限。超えたら演出を打ち切って操作可能に戻す */
const SAFETY_MS = 4000;

type Ink = InkOptions & { radius: number };

export function ModeTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ink, setInk] = useState<Ink | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fading, setFading] = useState(false);
  const pushedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  };

  const reset = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
    pushedRef.current = false;
    setInk(null);
    setExpanded(false);
    setFading(false);
  }, []);

  useEffect(() => reset, [reset]);

  const switchMode = useCallback(
    ({ x, y, color, href }: InkOptions) => {
      if (ink) return; // 演出中の多重起動を防ぐ
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        router.push(href);
        return;
      }
      // 押下点から最も遠いビューポート角まで届く半径
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );
      setInk({ x, y, color, href, radius });
      // 画面を覆い切るタイミングで遷移する。新画面はインクの下で描画される
      later(() => {
        pushedRef.current = true;
        router.push(href);
      }, EXPAND_MS);
      later(reset, SAFETY_MS);
    },
    [ink, reset, router],
  );

  // 円を scale(0) でマウント・描画させてから展開を開始する
  // （rAF 1回だと初期スタイルの paint 前に上書きされ、transition が発火しないことがある）
  useEffect(() => {
    if (!ink || expanded) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setExpanded(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [ink, expanded]);

  // 遷移先の描画（pathname の切り替わり）を確認してからインクをフェードアウト
  useEffect(() => {
    if (!ink || !fadeReady(ink, pathname, pushedRef.current) || fading) return;
    later(() => setFading(true), 120);
    later(reset, 120 + FADE_MS + 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, ink, fading]);

  return (
    <ModeTransitionContext.Provider value={{ switchMode }}>
      {children}
      {ink && (
        // 演出中は下の画面への誤タップを防ぐ（aria-hidden の全画面ブロッカー）
        <div className="fixed inset-0 z-[10000]" aria-hidden>
          <div
            style={{
              position: "fixed",
              left: ink.x - ink.radius,
              top: ink.y - ink.radius,
              width: ink.radius * 2,
              height: ink.radius * 2,
              borderRadius: "50%",
              backgroundColor: ink.color,
              transform: expanded ? "scale(1)" : "scale(0)",
              opacity: fading ? 0 : 1,
              transition: `transform ${EXPAND_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${FADE_MS}ms ease-out`,
              willChange: "transform, opacity",
            }}
          />
        </div>
      )}
    </ModeTransitionContext.Provider>
  );
}

function fadeReady(ink: Ink, pathname: string, pushed: boolean): boolean {
  if (!pushed) return false;
  return pathname === ink.href || pathname.startsWith(ink.href + "/");
}
