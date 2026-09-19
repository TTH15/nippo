# シフトメモの日別必要人数：本番公開記録

2026/09/14 23:23、ユーザーの「本番公開もしてください」の承認に基づき、シフトメモの日別必要人数をhakotora.jpへ公開した。

## 公開内容

- 公開前：`b009d456067c56975cd803b30a2e4452e1a5f8b5`、デプロイ `dpl_3dNWNnNa6k7D3NUvdpkAeYfUwxzb`。
- 公開後：`aa40e2db14d3ad6c4d568f1f0c1f24f08dc6207c`、ブランチ `codex/shift-memo-daily-count-release`、デプロイ `dpl_6qB7oq1YfBLLhNKSkJ6MArrHrt2Y`。
- Vercelプロジェクト：`nippo-ace`（`prj_S826TDW8STnqEjQpcqpHQy3Q6Bek`）。主作業ディレクトリの既定リンクは`hakotora-dev`のため、CLIで本番プロジェクトとscopeを明示した。
- 本番URL：<https://hakotora.jp/admin/shifts> →「シフトメモ」。担当枠×日の必要人数変更、通常復帰、保存再試行、不足集計、PNG/PDF表示を含む。
- DB変更なし。保存先は従来の端末・利用者ごとの個人メモ。正式シフトや共有メモAPIは変更しない。
- 車両3D・車検証読取・部位別色とDB164は別の未公開作業として残す。公開用コピーは本番公開済みb009d45を基点とし、シフトの実装・関連テスト・fixture・設計書・送信除外設定だけをコミットした。元の作業ツリーは保持。

## 公開手順と確認

1. 現在のhakotora.jpとVercelプロジェクトを読み取り、既存デプロイと照合。
2. 公開用コピーで126ファイル・1,184テスト成功。元の全作業ツリーで確認した1,204テストとの差は、今回公開しない車両改修を含めていないため。
3. `vercel deploy --dry --format=json`で送信対象を確認。1,190ファイル・57,624,548バイト。環境ファイル、DB接続ファイル、ローカルツール設定、docs、請求書保管庫、mobile、node_modules、他の未公開差分を除外。`.mcp.json`も`.vercelignore`に追加。
4. `vercel deploy --prod --skip-domain --archive=tgz`で待機中の本番デプロイを作成。Vercel側の依存インストール・Next.js 16.3.5ビルド・型検査が成功し、Readyを確認。ドメインが旧デプロイのままであることを切替直前に再確認。
5. `vercel promote`で公開。hakotora.jpが今回のデプロイを指し、Ready/productionであることを再照合。
6. 未認証の公開確認：`/login`と`/admin/shifts`が200、`/api/admin/shifts`と`/api/admin/vehicles`が401。
7. 本番シフトページから参照されるJS `/_next/static/immutable/chunks/3q2xhlwlxfdtz.js` が200で、`requiredCountOverrides`・「この日だけの必要人数」・「通常の人数に戻す」を含むことを確認。

実装時にPC1280px・スマホ390/320pxとPNG/PDF実ファイルを確認済み。公開後は業務データ更新や本番アカウントでの編集テストを行わず、配信内容・認証保護の確認までとした。

公開用ソースはGitに記録済み。GitHubへのpush/main同期は今回行っていない。以後の公開はこのaa40e2dを本番基点として、シフト変更を取り落とさないこと。
