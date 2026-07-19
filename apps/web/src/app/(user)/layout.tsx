import { Suspense } from "react";
import { Nav } from "@/lib/components/Nav";
import { UserBottomNav } from "@/lib/components/UserBottomNav";
import { TeamPointsBadge } from "@/lib/components/TeamPointsBadge";
import { Providers } from "@/lib/components/Providers";
import { ModeSwitchFab } from "@/lib/components/ModeSwitchFab";
import { DriverDesktopNotice } from "@/lib/components/DriverDesktopNotice";

export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      {/* ドライバー画面はスマホ幅専用。PC = 運営画面前提のため md 以上では非対応の案内を出す */}
      <div className="min-h-screen flex flex-col bg-[var(--color-bg)] md:hidden">
        <Nav variant="user" />
        <TeamPointsBadge />
        <main className="flex-1 user-main-with-bottom-nav">
          {children}
        </main>
        <Suspense fallback={null}>
          <UserBottomNav />
        </Suspense>
        {/* 運営権限を持つユーザーだけに表示される切替 FAB（スマホ幅のみ） */}
        <ModeSwitchFab mode="driver" />
      </div>
      <DriverDesktopNotice />
    </Providers>
  );
}
