"use client";

import { useSyncSession } from "@/lib/useSyncSession";

// 権限を裏で最新化するだけの部品（描画なし・画面は止めない）。
// admin 側は AdminAccessGuard が同期完了を待って入口判定するが、
// ドライバー側は権限で画面を止める必要がないため、待たずに同期だけ走らせる。
export function SessionSync() {
  useSyncSession();
  return null;
}
