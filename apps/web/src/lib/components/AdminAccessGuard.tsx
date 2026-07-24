"use client";

// 運営画面グループ（(admin) 配下全ページ）の入口ガード。
// 運営 capability を1つも持たないアカウント（ドライバー専任など）は
// URL 直打ちでも運営画面へ入れない。PC も同様。
// 認可の正本はサーバーの requirePermission（403）。ここは画面遷移の防壁。
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getStoredDriver } from "@/lib/api";
import { canEnterAdmin } from "@/lib/capabilities";
import { useSyncSession } from "@/lib/useSyncSession";

/**
 * 運営のログイン画面は (admin) 配下にあるが、ガードの対象外。
 * これから認証する画面を「未ログインだから」と弾くと、
 * /admin/portal-xxxx/login を開いた瞬間 /login へ飛ばされて永久に到達できない。
 */
export function isAdminLoginPath(pathname: string | null): boolean {
  return pathname?.endsWith("/login") ?? false;
}

export function AdminAccessGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLoginPage = isAdminLoginPath(pathname);
  const [allowed, setAllowed] = useState(false);
  // 権限の入口判定より先に、DB の最新権限へ同期する。
  // 古い localStorage の権限で弾かないため（例: 直前に付与された運営権限）。
  const syncState = useSyncSession();

  useEffect(() => {
    if (isLoginPage) return;
    if (syncState !== "done") return; // 同期完了まで判定を保留
    const driver = getStoredDriver();
    if (!driver) {
      router.replace("/login");
    } else if (!canEnterAdmin(driver)) {
      router.replace("/submit");
    } else {
      setAllowed(true);
    }
  }, [router, isLoginPage, syncState]);

  // ログイン画面は判定を挟まずそのまま描画する
  if (isLoginPage) return <>{children}</>;

  // 判定完了までは何も描画しない（権限のない人に運営画面の殻を見せない）
  if (!allowed) return null;
  return <>{children}</>;
}
