# シフトメモ・サイドバーの本番反映（2026/10/31）

## 対象

- シフト表とシフトメモの入口分離、コンパクトな期間・作業バー、行/列/セル選択と背景色、稼働日数、非稼働の札、範囲エクスポート。
- 読み取り中・中止・同一ファイル再試行・ファイルD&D、読み取り先/便/名前対応の修正、希望休警告と担当枠の稼働変更。
- サイドバーの滑らかな224↔64px切替。アイコン位置固定、下層アイコン保持、ページ間の閉じ状態保持、メニュー内だけの縦スクロール。

## 公開基点と境界

- 公開基点: origin/main `4aaa05ac979697f68285427b4098e02eea76c1a7`（PR74）。本番 `nippo-ace` の `dpl_2UBYjGwP6pAme4n2mXgWCBjk2uFL` とGit SHA・ドメイン割当を照合。
- 元のmain作業ツリーは別件の未コミット変更が多数あるため、新しい管理worktreeで今回分だけを選択。認証・DB・業務APIの接続方式、モバイル、Base、車両、日報の別件は含めない。
- 公開済みの便順・終了者/無効便/廃止コースの過去表示、振込先変更の認証復帰、CustomSelectのFont Awesome/underline、setupConfirmationDelayMsを維持。
- APIは既存requirePermissionと会社別Supabase/RPC経路を維持し、背景色の入力検証だけを追加。apiUploadは任意のAbortSignalだけを追加。
- CourseChipはtruncate指定時だけ内側のspanを追加し、既存の日報表示のDOMを維持。

## DB

- 背景色の移行は適用済み。実際のSupabase履歴に合わせて `20261031100243_shift_memo_background_colors.sql` として保存（ローカル作成時は20261025125853）。
- 事前にRPC定義を0600で退避し、BEGIN/ROLLBACKで適用を検証。適用後、owner=postgres、SECURITY INVOKER、search_path=public、service_roleだけへのEXECUTEを維持し、色の検証追加を確認。runtime版RPCは本番に存在しない。
- Security Advisorは前後とも2件で新規指摘なし。既存の指摘は今回変更しない。
- データ行の削除・修正やRLS/ACL変更は行わない。

## 検証

- Web233ファイル・1,973テスト成功。Web/preview/mobile/base型検査、tenant78表の静的検査、秘密値を使わないWeb webpackビルド成功。
- ネットワークなしの隔離Postgres17で12項目成功。色の保存/解除/検証/競合、既存配置保持、legacy/runtime、権限・会社・owner/ACL/RLS・ロックを確認。
- 公開候補の本番部品を再利用する隔離プレビューを3201で起動。架空データのみ、本番認証・DB・API・通知から隔離。
- PNGとPDFを実生成して目視。PDFは1ページ69,318 bytes、緑の列色・コースラベル・横線省略・札と希望休をPNGと照合。アプリは共通pngToPdfを継続使用。
- 出力、読取り、PC/スマホの確認画像とテストログはローカルのリリース証拠に保存。

## 公開状態

DB適用済み、Webは公開待ち。GitHubの検証完了後に本番へ反映する。
