"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/lib/components/Skeleton";
import { apiFetch, getStoredDriver, setAuth, type StoredDriver } from "@/lib/api";
import { canEnterAdmin } from "@/lib/capabilities";
import { getLastAppMode, isMobileWidth, resolveHomePath } from "@/lib/appMode";
import { markSessionSynced } from "@/lib/useSyncSession";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const goTo = (driver: StoredDriver | null) => {
      if (!driver) {
        router.replace("/login");
        return;
      }
      // 運営権限があっても、スマホで前回ドライバー画面を見ていたならそちらへ戻す
      router.replace(
        resolveHomePath({
          hasAdminAccess: canEnterAdmin(driver),
          lastMode: getLastAppMode(),
          isMobile: isMobileWidth(),
        }),
      );
    };

    const cached = getStoredDriver();
    if (!cached) {
      goTo(null);
      return;
    }

    // ローカルに保存されたroleはログイン時点のスナップショットで、権限の付与／剥奪が
    // 反映されない（例: 運営権限を剥奪された直後でも古い"ADMIN"のまま/adminへ飛び続ける）。
    // 起動のたびにDBの最新roleへ同期してからリダイレクト先を決める。
    apiFetch<{ token: string; driver: StoredDriver }>("/api/auth/session")
      .then(({ token, driver }) => {
        setAuth(token, driver);
        markSessionSynced(); // 直後に admin/user レイアウトが再同期しないように
        goTo(driver);
      })
      .catch(() => goTo(cached)); // 取得失敗時（オフライン等）は従来通りキャッシュ値で決定
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="flex flex-col items-center gap-3 w-48">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-full max-w-32" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}
