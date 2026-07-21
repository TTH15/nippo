"use client";

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell } from "@fortawesome/free-solid-svg-icons";
import { AdminLayout } from "@/lib/components/AdminLayout";
import { UnderlineTabs } from "@/lib/components/UnderlineTabs";
import { useApi } from "@/lib/useApi";
import { hasCapability } from "@/lib/capabilities";
import { BroadcastTab } from "./_components/BroadcastTab";
import { ChatTab } from "./_components/ChatTab";
import { SettingsTab } from "./_components/SettingsTab";
import { QuotaBar } from "./_components/QuotaBar";

// ============================================================
// 通知（roadmap-2026-07 E④）。3つの役割を1画面に集約する:
//   一斉配信 = 手動ブロードキャスト（notification-flow §3 モード3）
//   チャット = 連携済みドライバーとの1対1
//   自動配信 = 定時・イベント駆動の ON/OFF（§3 モード1・2）
// ============================================================

type TabValue = "broadcast" | "chat" | "settings";

export default function NotificationsPage() {
  const [canWrite, setCanWrite] = useState(false);
  const [tab, setTab] = useState<TabValue>("broadcast");

  useEffect(() => {
    setCanWrite(hasCapability("can_send_notifications"));
  }, []);

  // 未読はタブに出したいので、チャットを開いていなくても取得する
  const { data: chatSummary } = useApi<{ totalUnread: number }>(
    "/api/admin/notifications/chats",
    { refreshInterval: 60000 },
  );
  const unread = Number(chatSummary?.totalUnread) || 0;

  return (
    <AdminLayout>
      <div className="mx-auto max-w-4xl px-1 py-2 md:px-4 md:py-6">
        <div
          className="sticky z-30 -mx-3 px-3 pt-2 -mt-1 md:-mx-6 md:px-6 bg-slate-50 border-b border-slate-200/80"
          style={{ top: "var(--admin-header-h, 0px)" }}
        >
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <FontAwesomeIcon icon={faBell} className="text-slate-400" />
            通知
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            アプリの「お知らせ」に届きます。LINE連携済みの人にはLINEにも同時に届きます。
          </p>
          <UnderlineTabs
            className="mt-3"
            value={tab}
            onChange={(v) => setTab(v as TabValue)}
            tabs={[
              { value: "broadcast", label: "一斉配信" },
              { value: "chat", label: unread > 0 ? `チャット (${unread})` : "チャット" },
              { value: "settings", label: "自動配信" },
            ]}
          />
        </div>

        <QuotaBar />

        {tab === "broadcast" && <BroadcastTab />}
        {tab === "chat" && <ChatTab canWrite={canWrite} />}
        {tab === "settings" && <SettingsTab canWrite={canWrite} />}
      </div>
    </AdminLayout>
  );
}
