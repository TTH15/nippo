"use client";

// ピクセルが左から飛んできて「ハコ虎の箱」が組み上がるローディング。
// ロゴ（public/logo/hakotora-logo_icon_simple.svg）を 32×32 でピクセル化し、
// 右面の虎を外して「黒い箱＋黄色いテープ」だけにした地図を焼き込んでいる。
// 面の境界（ロゴでは白線）は隙間として抜くことで立体に見せる。
// 1サイクル = 組み上げ → 完成で一呼吸 → フェードアウト、を繰り返す。
// prefers-reduced-motion では完成状態の静止画にする。
import { useEffect, useMemo, useState } from "react";

// 32×32。D=箱の黒 / Y=テープの黄 / .=空
const LOGO_MAP = [
  "................................",
  "................................",
  "................................",
  "................................",
  "..............DDDD..............",
  "............DDDDDDDY............",
  "...........DDDDDDDYYYY..........",
  ".........DDDDDDDDYYYYDD.........",
  "........DDDDDDDYYYYDDDDD........",
  ".......DDDDDDDYYYDDDDDDDD.......",
  "......DDDDDDYYYYDDDDDDDDDD......",
  "......DDDDDYYYDDDDDDDDDDDD......",
  ".....DDDDDYYYDDDDDDDDDDDDD......",
  ".....DDDDDDYDDDDDDDDDDDDDD......",
  ".....DDDDYYDDDDDDDDDDDDDDD......",
  ".....DDDDYYDDDDDDDDDDDDDDD......",
  ".....DDDDYYDDDDDDDDDDDDDDD......",
  ".....DDDDYYDDDDDDDDDDDDDDD......",
  ".....DDDDDYDDDDDDDDDDDDDDD......",
  ".....DDDDDDDDDDDDDDDDDDDDD......",
  ".....DDDDDDDDDDDDDDDDDDDDD......",
  ".....DDDDDDDDDDDDDDDDDDDDD......",
  "......DDDDDDDDDDDDDDDDDDDD......",
  "........DDDDDDDDDDDDDDDD........",
  "..........DDDDDDDDDDDDDD........",
  "...........DDDDDDDDDDD..........",
  ".............DDDDDDD............",
  "...............D.D..............",
  "................................",
  "................................",
  "................................",
  "................................",
];

const W = 32;
const H = LOGO_MAP.length;
const CYCLE_MS = 4600;
const STEP_MS = 8; // 1ピクセルあたりの組み上げ間隔（左の列から順に）

const COLORS: Record<string, string> = { D: "#1a1a1a", Y: "#f4b400" };

// 面の境界（上面の下辺2本＋正面の縦の継ぎ目）。ロゴでは白線なので隙間として抜く。
// 上面ダイヤの左corner(6,11)・右corner(25,11)・下corner(16,17) を結ぶ線と、
// (16,17) から真下の縦継ぎ目。テープ（Y）の上も同様に抜く（折り目がエッジで切れて見える）。
function isEdgeGap(x: number, y: number): boolean {
  if (x >= 6 && x <= 16 && Math.abs(y - (11 + ((x - 6) * 6) / 10)) < 0.55) return true;
  if (x >= 16 && x <= 25 && Math.abs(y - (11 + ((25 - x) * 6) / 9)) < 0.55) return true;
  if (x === 16 && y >= 18 && y <= 26) return true; // 正面の縦の継ぎ目（底の輪郭まで貫通）
  return false;
}

type Cell = { x: number; y: number; color: string; order: number; jitter: number };

/** SSR/CSR で一致する決定的な疑似乱数（0〜1）。ピクセルごとの個体差に使う */
function hash01(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function buildCells(): Cell[] {
  const cells: (Omit<Cell, "order"> & { key: number })[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = LOGO_MAP[y][x];
      if (ch === ".") continue;
      if (isEdgeGap(x, y)) continue;
      const jitter = hash01(x, y);
      // 右から左へ完成していく（ロゴの「左側が崩れている」モチーフの逆再生）。
      // 列で揃わないよう±数列ぶんランダムに散らす
      cells.push({ x, y, color: COLORS[ch], jitter, key: W - x + jitter * 9 });
    }
  }
  const sorted = [...cells].sort((a, b) => a.key - b.key);
  const orderByKey = new Map(sorted.map((c, i) => [`${c.x}:${c.y}`, i]));
  return cells.map(({ key: _key, ...c }) => ({
    ...c,
    order: orderByKey.get(`${c.x}:${c.y}`) ?? 0,
  }));
}

// 調整用: true にするとアニメーションを止めて完成状態の静止画で表示する（LOGO_MAP を調整するとき用）
const STATIC_PREVIEW = false;

export function PixelBoxLoader({ pixel = 5 }: { pixel?: number }) {
  const cells = useMemo(buildCells, []);
  const [reduced, setReduced] = useState(false);
  // ループ: サイクル毎に key を変えて組み上げアニメーションを再生し直す
  const [cycle, setCycle] = useState(0);
  const still = reduced || STATIC_PREVIEW;

  useEffect(() => {
    if (STATIC_PREVIEW) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    if (mq.matches) return;
    const t = setInterval(() => setCycle((c) => c + 1), CYCLE_MS);
    return () => clearInterval(t);
  }, []);

  // 上下の余白行を除いた実表示域に高さを詰める
  const top = 5;
  const bottom = 28;
  const width = W * pixel;
  const height = (bottom - top) * pixel;

  return (
    <div aria-hidden role="presentation">
      <style>{`
        @keyframes pixelbox-flyin {
          from { opacity: 0; transform: translateX(${-6 * pixel}px); }
          70% { opacity: 1; transform: translateX(${0.6 * pixel}px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes pixelbox-cycle {
          0%, 88% { opacity: 1; }
          97%, 100% { opacity: 0; }
        }
      `}</style>
      <div
        key={cycle}
        style={{
          position: "relative",
          width,
          height,
          animation: still ? undefined : `pixelbox-cycle ${CYCLE_MS}ms linear both`,
        }}
      >
        {cells.map((c) => (
          <span
            key={`${c.x}:${c.y}`}
            style={{
              position: "absolute",
              left: c.x * pixel,
              top: (c.y - top) * pixel,
              width: pixel - 1,
              height: pixel - 1,
              backgroundColor: c.color,
              // 飛行時間にも個体差をつけて「1ピクセルずつ」感を出す
              animation: still
                ? undefined
                : `pixelbox-flyin ${Math.round(260 + c.jitter * 160)}ms cubic-bezier(0.2, 0.7, 0.3, 1) both`,
              animationDelay: still ? undefined : `${c.order * STEP_MS}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 画面全体を覆うローディングオーバーレイ。
 * 「ボタンを押せたのか分かりにくい」画面遷移前の処理（請求書作成など）に使う。
 */
export function PixelLoadingOverlay({
  message,
  subMessage,
}: {
  message: string;
  subMessage?: string;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-white/85 backdrop-blur-sm">
      <PixelBoxLoader />
      <p className="text-sm font-medium text-slate-700">{message}</p>
      {subMessage && <p className="text-[11px] text-slate-400">{subMessage}</p>}
    </div>
  );
}
