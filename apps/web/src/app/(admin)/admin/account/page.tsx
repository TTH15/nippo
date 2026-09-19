"use client";

import { useEffect, useState } from "react";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { getStoredDriver, type StoredDriver } from "@/lib/api";

import { PasskeyManagement } from "@/lib/components/PasskeyManagement";

export default function AdminAccountPage() {
  const [driver, setDriver] = useState<StoredDriver | null>(null);
  useEffect(() => { setDriver(getStoredDriver()); }, []);
  return <AdminLayout>
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-lg font-bold text-slate-900">アカウント設定</h1>
      <h2 className="mb-4 text-base font-bold text-slate-900">{driver?.name}</h2>
      <PasskeyManagement />
    </div>
  </AdminLayout>;
}
