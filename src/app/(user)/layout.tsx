import { Suspense } from "react";
import { Nav } from "@/lib/components/Nav";
import { UserBottomNav } from "@/lib/components/UserBottomNav";

export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)]">
      <Nav variant="user" />
      <main className="flex-1 pb-16">
        {children}
      </main>
      <Suspense fallback={null}>
        <UserBottomNav />
      </Suspense>
    </div>
  );
}
