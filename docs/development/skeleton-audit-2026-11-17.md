# スマホの読み込み表示・追加監査（2026/11/17）

前回の19画面に続き、未確認だったページと、詳細を開いた後の読み込み表示を確認した。既存の未コミット変更は開始時0件（main `a6616bd9`）。別worktree・DB・個人権限は変更していない。

## 結果

- アプリ内ブラウザで34ページ×320／390／768／1280px＝136パターンを追加確認。
- 詳細・モーダル・タブ・送信後など20状態×4幅＝80パターンを確認（修正後の調整履歴とMapboxありの地図を含む）。可視スケルトンの重なり0件、ページ幅のはみ出し0件。
- 調整履歴で月表示がスマホ幅で縮んで改行する問題を確認し、見出しと月切替の折り返し・月表示の幅を修正。通常・読み込み中と前月／当月への切替を確認した。
- スケルトンそのものには追加の重なりは見つからなかった。前回の共通Skeletonの幅制限が、未確認だった画面にも効いている。

## 再利用した本番ページ

`npm run preview:admin -- admin --port 3197` で起動する。`/preview/admin/<slug>?scenario=loading&role=admin`。以下は本番ページ本体を読み込み、認証・API・DB・通知をfixtureへ隔離したもの。

| 区分 | slug |
| --- | --- |
| キャリア・配達・イベント・通知 | carriers, delivery, events, notifications, driver-notifications |
| 金額・請求書 | rewards, adjustments, invoice-preview, invoice-edit, invoice-individual-preview, invoice-individual-edit, invoice-new, bank-cleanup, counterparties |
| その他の業務 | spot-jobs, driver-report, attendance, records, record-forms, misc-reports, other-reports, driver-records, submit-screen |
| アカウント・登録・運営窓口 | account, platform-recovery, login, onboarding, recover, bank-change, driver-setup, platform-home, platform-applications |
| ホーム・地図 | home-loading, map |

ドライバー画面は本番のNav／UserBottomNav／本文枠、運営窓口はPlatformLayoutを再利用する。ホームは遷移前のJSXをHomeLoadingへ抽出し、本番とプレビューで共有した（遷移処理は変更なし）。新しい補助fixtureの通常状態は必要最小限の架空データ・空一覧で、更新操作を網羅するものではない。

## 詳細・条件付きの読み込み表示

| 開くURL（/preview/admin/の後） | 操作・対象 |
| --- | --- |
| users?scenario=detail-loading | 名簿の名前→編集フォーム |
| users-pending?scenario=kyc-loading | 承認→免許・顔・個人情報の骨格、確認→本人確認モーダル |
| daily?scenario=proxy-loading | 代理入力→報告項目の読み込み |
| payments?scenario=detail-loading | 行を展開→収入明細、経費を編集→報酬・固定・臨時経費 |
| report-images?scenario=image-loading | 原本の行→画像読み込み |
| notifications?scenario=loading | チャット一覧、自動配信のタブ |
| notifications?scenario=chat-loading | チャット→架空の会話を開く |
| events?scenario=detail-loading | イベントを選択→詳細 |
| events?scenario=ranking-loading | イベントを選択→ランキング |
| driver-report?scenario=vehicle-loading | 車両一覧だけ待機したフォーム |
| submit?scenario=post-loading | 距離・完了個数・置き場所を入力して送信→送信後画面。続けて入力する、で復帰 |
| shifts?scenario=settings-loading | 設定→提出締切／便／必要人数／未解決の期限。これらは文字の待機表示で、スケルトンは使わない。Escapeで閉じる操作も確認 |
| adjustments?scenario=loading | 修正後の月表示・読み込み表示 |
| map?scenario=loading | 下記のMapboxモードで地図上の骨格を確認 |

詳細だけ待機させるため、fixtureに任意の`isPending`を追加した。ページ一覧のデータを保ったまま、該当GETだけを未完了にする。共通`loading`／`error`と通常状態は維持。実APIの遅延・本番認証を操作するものではない。

地図の実表示だけは `npm run preview:admin -- admin --port 3198 --mapbox` で確認。公開Mapboxキー1項目だけを使い、地図タイルを取得した。架空位置・fixtureのままで、本番DB・位置送信・通知には接続しない。監査後はこの追加サーバーを停止し、3197の完全隔離プレビューを残した。

## 監査方法と検証

- 共通Skeletonと生のanimate-pulseを全Webソースから棚卸し。保存中の小さな状態点・撮影の点滅ガイドは骨格と区別した。
- DOM矩形を親のスクロール／クリップ領域で補正して、表示される骨格同士の交差を検査。PC用に非表示の表や、スクロール領域の外に隠れた行は重なりに数えない。スクリーンショットでも配置を確認した。
- 新しいページの取得失敗→通常シナリオへの切替、エラーダイアログを閉じる操作、モーダルの取消・閉じる、送信後の復帰を確認。console errorなし（意図したfixture取得失敗を除く）。
- Web251ファイル／2054テスト成功、Web／プレビュー／mobile／base型検査成功。初回の全体テストは既存5件が5秒上限でtimeout。並列数を2に制限した `npm -w @repo/web run test -- --maxWorkers=2` で全件成功。検証用に製品コードのtimeoutは変えていない。
- 証跡: `/Users/H.Takaya/Developer/backups/hakotora-skeleton-followup-20261117/` のpage-audit.json／detail-audit.json／recovery-audit.jsonと画像。

## 範囲の区別

- 勤怠・取引先・記録・請求書編集・アカウント等は文字や利用案内の待機表示で、骨格なし。これらも実際に開いて4幅を確認した。
- 現行ルートから使われない旧SubmitPageClient、個人シフトメモの初回hydrateにだけ出る単一ブロックはソースで確認した。後者には隣接する骨格がなく、通常の個人／共有メモは前回の実画面監査対象。
- 規約・プライバシー等の静的ページ、スケルトンを持たない入力／確認モーダルはソースで対象外と判定。ネイティブアプリ実機・全ブラウザの描画差・本番の業務データを変更するE2Eは今回の対象外。
