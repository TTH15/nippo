# Webの利用開始準備・マイページ

2026/10/13。独立ブランチ `codex/driver-start-setup`、基点 `main` の `3321f6f0`。
既存のセキュリティ対応ブランチと元checkoutの未保存変更は取り込まない。本番公開・DB変更・API認可変更・モバイルアプリ変更は含めない。

## 利用者の動き

- Webのドライバー画面を開くと、本人の登録状態を取得する。電話番号未確認または振込口座3項目の不足があれば通常画面とナビを背景に残して「利用開始の準備」モーダルを重ねる。背景はinert・aria-hiddenで操作対象から外す。
- 登録済みの電話番号へSMSを送り、6桁のコードを確認する。誤コード・送信失敗・再送に対応。番号の自由な変更は認めない。番号なしは運営へ登録を依頼する。
- 銀行名・支店、口座番号、名義を登録する。口座番号は既存mobileの数字・最大8桁に揃え、先頭の0を保持する。口座種別などDBにない項目を追加しない。
- 保存・SMS確認後は本人の状態を再取得する。口座は送った3項目と一致することも確認する。失敗時は入力を保持し、再読み込み・再保存で復帰する。
- 両項目がそろうと「利用を開始する」が有効になる。既に両方完了した利用者は準備画面を省略する。途中の完了状態は既存APIに保存され、再訪時に再取得する。
- マイページ上部に登録情報をまとめる。口座は末尾4桁を表示、編集時のみ全文を表示する。未保存の口座は共通離脱確認で保護し、「変更を取り消す」で元に戻せる。

## 再利用元と境界

実装の土台は `apps/web/src/app/(user)/me/page.tsx` のプロフィール・SMS処理、およびmobileの既存振込口座3項目。`DriverSetupPanel` をマイページと利用前のゲートで共用する。ロゴ・Nav・UserBottomNav・プロフィール一覧・PasskeyManagementは既存を使用。入力モーダルはEditorModal、キーボード巡回はuseModalKeys、背景スクロール固定はuseBodyScrollLock。開閉はSmoothCollapse、離脱確認はuseUnsavedChanges、ログアウト確認はConfirmDialog。

取得は既存 `/api/reports/profile` と `/api/me/registration`、保存は `/api/me/registration`、電話確認は `/api/me/phone/send` と `/api/me/phone/verify`。本人・会社の認可、trustedPhone照合、OTP検証、認証世代、localStorageキー、vendorパッケージを変更しない。KYCの本登録完了条件やPasskeyの必須条件も変更しない。

今回のゲートはWeb画面の導線であり、業務APIそのものの未登録者拒否条件ではない。通常APIを直接呼ぶクライアントやmobileにも同じ必須条件を適用する場合は、対象業務・稼働中利用者への影響を含めたサーバー側の別レビューが必要。

## 隔離プレビュー

このworktreeで `npm run preview:admin -- admin --port 3241`。

- `/preview/admin/driver-setup?scenario=both-missing`：準備画面から両項目の完了、利用開始、実マイページへの切替。
- `/preview/admin/me?scenario=normal`：実マイページを直接表示。
- シナリオ：both-missing / phone-missing / bank-missing / no-phone / normal / registered / long-name / loading / error / save-error / refresh-error。
- 架空SMSコード `123456`、誤コード `000000`。モーダルではURLの `scenario=save-error` で口座保存失敗を模擬する。マイページ単独表示では「次の保存を失敗させる」で送信・確認・口座保存の失敗を模擬する。初期化・再読込でfixtureを戻す。
- 本番認証・API・DB・通知・実SMS・OS Passkeyに接続しない。保存はメモリのみ。プレビューでは監査のためPCでもマイページ本体を表示する。本番の登録完了後は既存のPC利用案内を維持する。
- fresh GETはfixtureの該当キーだけ読み直す。購読通知でSWR取得を循環させない。resetVersionで初期化時だけフォームを再マウントする。

## 検証と残確認

- 関連7ファイル45テスト成功。未完了3組合せ、両方完了、取得失敗、口座保存失敗・入力保持、SMS誤入力、サーバー未確認なら通過しないこと、保存後の再取得失敗・復帰、8桁口座・先頭0、末尾表示と編集を確認。既存本人用API・phoneEnrollment・fixture再取得の回帰も検証。
- WebとpreviewのTypeScript検査成功。共有インストールがTypeScript 6のため、コマンドに `--ignoreDeprecations 6.0 --noUncheckedSideEffectImports false` を指定した。既存configは変更しない。
- アプリ内ブラウザで1280 / 768 / 390 / 320pxを確認。横はみ出しなし。長い支店・名義、編集・取り消し、SMS誤コード・再送、保存失敗と再保存、保存後の取得失敗と再読み込み、両完了からマイページ、番号なし、loading/error、fixture初期化を操作。最終版のマイページ遷移でconsole error/warnなし。
- 実SMS到達、実アカウントの口座保存、OS Passkey、ネイティブ実機、ブラウザ戻るの未保存保護、全業務画面の回帰、本番環境での通し確認は未実施。本番公開は未実施。


## 2026/10/13 モーダルへの改修

- 利用前の専用ページ表示を廃止し、通常画面を背景に残す。共通EditorModalへ `dismissible=false` を追加した。通常の編集モーダルは従来どおり閉じられる。
- モーダルは外側に余白と半透明の背景を持ち、入力部分だけスクロールする。見出しと利用開始・ログアウトの操作は固定する。初期フォーカスは見出し、Tabは中で巡回し、背景クリック・Escapeでは閉じない。
- ログアウト確認はさらに上に表示し、Escapeでその確認だけを閉じられる。入力未完了のモーダルは残る。
- 完了後は背景の操作とスクロール固定を解除する。操作できなかった背景を再マウントして登録状況を読み直し、登録前のマイページ表示を残さない。
- 関連8ファイル48テスト・Web/preview型検査成功。モーダル内の保存失敗・再試行、SMS確認、状態取得失敗・再読み込み、完了後の反映、Tab巡回、背景クリック・Escape、ログアウト確認からの復帰をアプリ内ブラウザで検証。1280/768/390/320pxで横はみ出しなし・モーダル内スクロールを確認。
- 実機キーボード・Safe Area、全ドライバー画面の背景表示と初期読込の通し確認は未実施。実SMS・実保存・本番公開の未検証範囲は前節のまま。
