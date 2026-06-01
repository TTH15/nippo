import { Suspense } from "react";
import { Nav } from "@/lib/components/Nav";
import { UserBottomNav } from "@/lib/components/UserBottomNav";
import { TeamPointsBadge } from "@/lib/components/TeamPointsBadge";

export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)]">
      <Nav variant="user" />
      <TeamPointsBadge />
      <main className="flex-1 user-main-with-bottom-nav">
        {children}
      </main>
      <Suspense fallback={null}>
        <UserBottomNav />
      </Suspense>
    </div>
  );
}
