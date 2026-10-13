"use client";
import Link from "next/link";
import { DriverSetupPanel } from "@/lib/components/DriverSetupGate";
import { Nav } from "@/lib/components/Nav";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft } from "@fortawesome/free-solid-svg-icons";

export default function BankChangePageContent() {
  return <div className="min-h-screen bg-[var(--color-bg)]"><Nav variant="user" />
    <main className="mx-auto w-full max-w-lg px-4 py-6">
      <Link href="/me" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-slate-600"><FontAwesomeIcon icon={faChevronLeft} className="w-3" />マイページ</Link>
      <h1 className="mb-6 text-xl font-bold text-slate-900">振込口座の変更</h1>
      <DriverSetupPanel bankChangePage />
    </main>
  </div>;
}
