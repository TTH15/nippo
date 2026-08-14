"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/lib/components/Skeleton";
import { getStoredDriver, type StoredDriver } from "@/lib/api";
import { canEnterAdmin } from "@/lib/capabilities";
import { getLastAppMode, isMobileWidth, resolveHomePath } from "@/lib/appMode";

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

    // キャッシュ値で即遷移する（従来は /api/auth/session を待つ1往復ぶん白画面だった・2026-08 監査）。
    // 権限の最新化（付与/剥奪の反映）は遷移先が行う: admin は AdminAccessGuard が
    // 同期+ガード（権限が無ければ弾く）、user レイアウトは useSyncSession が再同期する。
    goTo(getStoredDriver());
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
