// 管理画面グループのレイアウト。
// ドライバー用の Nav / UserBottomNav は付けない（admin と user を分離）。
// 各 admin ページは自前で <AdminLayout>（サイドバー）を描画する。
export default function AdminGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-[var(--color-bg)]">{children}</div>;
}
