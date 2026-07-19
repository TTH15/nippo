// 管理画面グループのレイアウト。
// ドライバー用の Nav / UserBottomNav は付けない（admin と user を分離）。
// 各 admin ページは自前で <AdminLayout>（サイドバー）を描画する。
//
// Providers(SWRConfig) はこの永続レイアウトに置くことで、
// 管理画面のページ間遷移をまたいでキャッシュを共有する（再訪時の点滅をなくす）。
import { Providers } from "@/lib/components/Providers";

export default function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      {/* data-mode: スマホ幅では globals.css がこれを見て body をチャコール化する */}
      <div
        data-mode="admin"
        className="min-h-screen bg-[var(--color-bg)] max-md:bg-[var(--mode-admin-bg)]"
      >
        {children}
      </div>
    </Providers>
  );
}
