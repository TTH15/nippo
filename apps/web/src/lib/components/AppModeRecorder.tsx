"use client";

import { useEffect } from "react";
import { rememberAppMode, type AppMode } from "@/lib/appMode";

// 現在いる画面モードを記録するだけの部品（描画なし）。
// 切替 FAB のクリックだけを拾うと、直リンク・ブラウザバック・ブックマークでの
// 移動を取りこぼすため、レイアウトの mount で記録する。
export function AppModeRecorder({ mode }: { mode: AppMode }) {
  useEffect(() => {
    rememberAppMode(mode);
  }, [mode]);

  return null;
}
