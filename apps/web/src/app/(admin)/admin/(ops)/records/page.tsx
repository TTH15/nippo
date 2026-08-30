"use client";
import { AdminLayout } from "@/lib/components/AdminLayout";
import RecordFormsApp from "@/lib/recordForms/RecordFormsApp";
export default function Page() {
  return (
    <AdminLayout>
      <RecordFormsApp />
    </AdminLayout>
  );
}
