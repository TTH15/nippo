# 管理メニューの開閉

対象: apps/web/src/lib/components/AdminLayout.tsx と apps/web/src/app/preview/driver-leases/AdminPreviewLayout.tsx。開閉UIは apps/web/src/lib/components/AdminSidebar.tsx を共用する。

## 2026-10-30 18:11 左側の管理メニューをボタンで開閉

- 変更内容: 共通AdminSidebarを追加し、本番AdminLayoutと複製プレビューAdminPreviewLayoutで共用。PCのロゴ横の×クリックでメニューを閉じ、48pxの欄に残すメニューボタンで開き直す。閉じたメニューはhidden/inertで操作対象から除外し、開閉後のフォーカスをボタンへ移す。メニュー内容はマウントを維持し、メイン画面の保存・認可は変更しない。
- 検証結果: Web/preview型検査・対象diff検査成功。隔離プレビューでPC1280pxのクリックによる閉じる/開く、Enterによる再展開、フォーカス、閉じた欄の48px幅、表示期間と表の維持を確認。390pxでは従来のスマホメニューを開き、×クリックで閉じることと横はみ出しなしを確認。console errorなし。完成プレビューと確認画像を保存。
- 残課題: 本番未反映。実機・全画面/全権限・リロードをまたぐ開閉状態の保存は対象外。新規ユニットテストは追加せず実画面の操作と型検査で確認。起動は npm run preview:admin -- admin --port 3200 、完成URLは http://127.0.0.1:3200/preview/admin/shifts?scenario=memo-colors&role=admin&editor=sidebar-final 。既存memo-colors fixtureで本番ページと管理レイアウトを再利用し、架空データ・認証/DB/API/通知から隔離。


## 2026/10/31の公開

実装時の記録を上に残しています。今回の公開状況と検証は [公開記録](../deployment/shift-memo-sidebar-2026-10-31.md) を参照。
