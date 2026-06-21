"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/lib/components/Skeleton";
import { getStoredDriver } from "@/lib/api";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const driver = getStoredDriver();
    if (!driver) {
      router.replace("/login");
    } else if (driver.role === "ADMIN" || driver.role === "ADMIN_VIEWER") {
      router.replace("/admin");
    } else {
      router.replace("/submit");
    }
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
