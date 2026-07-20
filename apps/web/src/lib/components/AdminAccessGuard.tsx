"use client";

// 運営画面グループ（(admin) 配下全ページ）の入口ガード。
// 運営 capability を1つも持たないアカウント（ドライバー専任など）は
// URL 直打ちでも運営画面へ入れない。PC も同様。
// 認可の正本はサーバーの requirePermission（403）。ここは画面遷移の防壁。
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredDriver } from "@/lib/api";
import { canEnterAdmin } from "@/lib/capabilities";

export function AdminAccessGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const driver = getStoredDriver();
    if (!driver) {
      router.replace("/login");
    } else if (!canEnterAdmin(driver)) {
      router.replace("/submit");
    } else {
      setAllowed(true);
    }
  }, [router]);

  // 判定完了までは何も描画しない（権限のない人に運営画面の殻を見せない）
  if (!allowed) return null;
  return <>{children}</>;
}
