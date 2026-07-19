import { Suspense } from "react";
import { Nav } from "@/lib/components/Nav";
import { UserBottomNav } from "@/lib/components/UserBottomNav";
import { TeamPointsBadge } from "@/lib/components/TeamPointsBadge";
import { Providers } from "@/lib/components/Providers";
import { ModeSwitchFab } from "@/lib/components/ModeSwitchFab";

export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="min-h-screen flex flex-col bg-[var(--color-bg)]">
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
    </Providers>
  );
}
