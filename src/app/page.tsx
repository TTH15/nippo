"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStoredDriver } from "@/lib/api";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const driver = getStoredDriver();
    if (!driver) {
      router.replace("/login");
    } else if (driver.role === "ADMIN") {
      router.replace("/admin");
    } else {
      router.replace("/submit");
    }
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-pulse text-brand-700 font-semibold">読み込み中...</div>
    </div>
  );
}
