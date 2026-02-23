"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AdminLayout } from "@/lib/components/AdminLayout";

export default function AdminPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/sales");
  }, [router]);

  return (
    <AdminLayout>
      <div className="flex items-center justify-center min-h-[200px]">
        <p className="text-sm text-slate-500">売上ページへ移動中...</p>
      </div>
    </AdminLayout>
  );
}
