# ハコ虎の内部配布・ネイティブPasskey

2026/09/21。ローカル実装を含む設計記録。EAS・Apple・Google・DB・Webの外部変更は未実施。新規招待のmigration 183とWeb差分は引き続き未公開。PIN停止はこの作業に含めない。

## 2026/09/21 21:59 更新：Expo導入・EAS紐付け完了

ユーザーがExpoアカウントを作成し、明示指定のprojectへ既存 `apps/mobile` を紐付けた。Expoプラグイン追加、CLIのブラウザ認証、EAS `init` / `project:info` を完了し、`@next-eight/hakotora` / `c874c3eb-642e-4670-8706-31e47e821d76` を照合。owner/project IDはapp.jsonに保存済みで、通常は環境変数注入不要。下記の「EAS未確定」は開始時点の記録。

Android対象のローカルreleaseチェックは成功。Apple Team/UDID、署名、サーバー関連付けの公開、native build・実機配布は未実施。[実行記録](../deployment/mobile-internal-first-build-2026-09.md)。

## コード・設定の再確認

| 項目 | 開始時点の確認結果 | 今回のローカル対応 |
|---|---|---|
| Expo/RN/React | SDK 57 / RN 0.86 / React 19.2.3 | 維持。vendorとrootのReact依存は変更しない |
| アプリ識別子 | iOS/Androidとも `jp.hakotora.app` | 維持。旧資料の `.driver` / `com.example` は採用しない |
| 表示名/slug | `Nippo Mobile (dev)` / `nippo-mobile` | 表示名「ハコ虎」、slug候補 `hakotora`。既存EAS project発見時は `EAS_PROJECT_SLUG` で既存slugを指定 |
| EAS | development/preview internal、production store。projectId/ownerなし、CLIなし | 環境・APKを明示。project IDを捏造せず環境変数から注入 |
| 署名 | git管理外iOSプロジェクトに `R7Z5XNJAY9` 候補 | 現契約・App ID prefix・配布権限は未確認。AASAへ自動採用しない |
| 環境 | 手元 `.env` は `https://hakotora-dev.vercel.app`、EASは全profile `https://hakotora.jp` | 配布前チェックで接続先を表示。EXPO_NO_DOTENVでローカル検査から環境ファイルを除外 |
| ネイティブ生成物 | ignoredな古いios/Podsあり、Git管理なし | 既存を上書き/削除せず、配布は選別した新規チェックアウトからCNGで生成 |
| 認証 | SMSログイン、30日JWT/SecureStore、端末内ロック。ネイティブPasskeyなし | OSのPasskeyを追加。保存キー `nippo_token` / `nippo_driver` を維持 |
| 画像 | ロゴPNGあり、app icon未指定 | 既存 `logo-icon.png` を指定。ストア提出用1024pxアイコン最終確認は残る |

EASクラウドにプロジェクトが「存在しない」とは断定しない。ローカルから未紐付けであり、クラウドの所有者・project・署名資格情報・Apple/Google契約状態は未照合。

作業開始時のtracked差分は `/tmp/hakotora-before-native-passkey.patch` に退避。既存のWebオンボーディング、Base、駐車位置送信の差分を保持した。今回重ねた既存差分は `location.ts` の待機上限、`WorkScreen.tsx` の駐車データ/選択部品の抽出、追記文書。`DailyReportForm.tsx` とvendorは未編集。

## ネイティブ方式とドメイン

`react-native-passkey` 3.6.2を固定し、iOS AuthenticationServices / Android Credential Managerを呼ぶ。Expo Goではなく新しいネイティブビルドが必要。SDK57との実コンパイル・実機検証はJS型検査やexportと区別する。

- RP IDは `hakotora.jp`、iOS/Web originは `https://hakotora.jp`。Webと同じidentity・資格情報を使う。discoverable credentialと `userVerification: required` を維持し、特定の生体方式に制限しない。Face ID、指紋、パターン、画面ロックのPINはOSが選ぶ。既存の端末内アプリロックはサーバーのPasskey認証とは別。
- iOSは `webcredentials:hakotora.jp` をAssociated Domainsに設定。AASAは `PASSKEY_APPLE_APP_ID=<App ID prefix>.jp.hakotora.app` の1アプリのみ。prefixはTeam IDと同じと決めつけず署名profileのapplication-identifierで確認する。App IDのcapabilityとprofile更新は承認後。
- Androidは配布バイナリの**署名証明書**のSHA-256指紋を `PASSKEY_ANDROID_SHA256_CERT_FINGERPRINTS` にカンマ区切りで設定。DALのpackageは `jp.hakotora.app`、relationは資格情報共有だけ。署名のバイト列からbase64url化した `android:apk-key-hash:…` を同じ設定から導出し、Web originと完全一致の許可リストにする。
- EAS APK用署名とPlay App Signingのアプリ署名は別になり得る。Playのupload keyをアプリ署名と取り違えない。開発用debug証明書を本番へ登録しない。申告されたplatform・origin・HTTP Hostで許可範囲を広げない。
- `/.well-known/apple-app-site-association` / `assetlinks.json` を認証なしJSONで返す。設定前/不正設定は503・no-store。設定後は200・JSON・短いcache。公開時にredirect・CDNキャッシュ・Google取得制限・Apple CDN反映を確認する。applinksと招待リンク横取りは今回追加しない。

根拠: [ライブラリ公式](https://github.com/f-23/react-native-passkey)、[AppleのPasskey構成](https://developer.apple.com/documentation/authenticationservices/connecting-to-a-service-with-passkeys)、[Androidの関連付け](https://developer.android.com/identity/credential-manager/prerequisites)、[Androidの署名origin](https://developer.android.com/identity/passkeys/create-passkeys)。

## API・認証の作業単位

| 操作 | 使う既存API | 維持する境界 |
|---|---|---|
| SMS初回ログイン/復旧 | `/api/otp/send` → `/api/auth/recover/verify` | 検証済み電話番号のidentity、有効所属のみ。任意番号で既存人へ紐付けない |
| 既存人のSMS初回確認 | Web既存セッション、またはモバイルマイページ `/api/me/phone/send` → `/verify` | 保存済み本人番号・所属・OTPの条件を維持 |
| パスキー再ログイン | `/api/auth/webauthn/login/options` → OS get → `/verify` | challengeの用途/期限/単回消費、署名・RP・origin・UV、有効所属、counter競合 |
| 登録/追加 | `/api/auth/reauth` → 必要時再確認 → `/api/auth/webauthn/register/options` → OS create → `/verify` | 5分以内の本人確認、identity一致、既存manage_passkey RPC・通知 |
| 一覧/削除 | `/api/me/passkeys` GET/DELETE | 本人の鍵のみ、直近確認、SMS未確認の最後の鍵保護。削除確認を表示 |
| 再本人確認 | `/api/auth/reauth/options` → `/verify` のSMS/Passkey | identityと現在のBearerへ結び付けた短命grant。メモリだけで使う |

サーバーの実変更は関連付け2ルートと `rpConfig().origin` の配列化。登録・ログイン・再本人確認の3検証箇所はこの共通設定を既に参照する。SMS復旧APIやDB schemaを新設しない。ネイティブ部分だけなら追加migration不要。ただし未公開Web差分とまとめて公開する場合は先に183が必要。

UIの名称は「かんたんログイン（パスキー）」。失敗/キャンセルでセッションを発行しない。SMS復旧後は設定へ進み、既存人は業務へ戻れる。新規招待必須化はWebオンボーディング/APIの条件を継続し、ネイティブで回避しない。登録途中/承認待ちの人は既存の登録ゲートへ戻す。

## 端末変更・紛失の復旧

1. 同期したパスキーが新端末にある場合は通常ログイン。同じApple/Googleアカウントでも同期を保証せず、異なるOS間も必ず同じ鍵が使えるとは案内しない。
2. パスキーなし・キャンセル・非対応はSMS。**確認済み番号を受信できること**が条件。OTP成功後に既存セッションを発行し、新しい鍵を登録できる。SMS未確認の10名は先に今のWeb/PINセッションから確認する。17名を一括ログアウトさせない。
3. 電話番号も使えない場合は運営へ連絡。電話番号だけの自己申告で置き換えない。本人確認担当・確認資料・二者確認の要否・連絡手段を運用で決め、対象identity/driver/所属・旧新番号・理由を記録して個別承認を得る。電話番号の再紐付けを公開APIで自動化しない。
4. 紛失・盗難はSMSで入れただけでは完了しない。鍵削除は**既発行JWTの失効ではない**。運営が本人確認後、必要なdriverのtoken_versionを更新して既存セッションを失効させ、紛失した鍵も撤去し、新端末で再ログインする。複数所属の場合の対象範囲は個別に確認する。今回この本番更新も専用の復旧管理UIも実装/実行していない。
5. 誤削除防止のため、予備鍵追加/確認済みSMSを先に確保する。追加・削除の既存通知は本番適用後のAPI操作で発生する。プレビューは一切送信しない。

## 内部配布までの順序と承認対象

| 単位 | 対象・影響 | 状態/承認 |
|---|---|---|
| M-N1 ローカル | 表示名/slug候補・EAS profile・認証クライアント・origin/DAL・測位・テスト | このセッションで実装。公開なし |
| M-N2 所有者照合 | Expo owner・既存project/slug・Apple契約/Team・Android署名の読み取り照合 | 要アカウント情報。作成/紐付け前に対象projectを提示 |
| M-N3 EAS設定 | 既存project紐付け、または `hakotora` 新規作成。env/資格情報・利用料金 | **実行前承認**。既存app UUIDを勝手に作り替えない |
| M-N4 サーバー先行 | 署名指紋・App ID prefixの環境設定、AASA/DALとoriginのWeb公開 | **実行前承認**。Web必須化を含めるならmigration 183→Web。dirty treeの一括公開禁止 |
| M-N5 ビルド | Android preview APK、iOS ad hoc preview。コードをEASへアップロード、署名profile生成、UDID登録 | **実行前承認**。最初は少数の運営検証端末のみ。端末追加はprofile更新が必要 |
| M-N6 配布 | 配布URL/インストール・本番SMS/認証/日報/駐車書き込み | **実行前承認**。誰のどの車両・何の日報を使うか確定し、通知・位置送信を含む実機確認 |
| M-N7 拡大 | iOS TestFlight / Android Play内部テスト、17名へ段階案内 | 別承認。iOSはproduction store build、AndroidはAABとPlay署名指紋の追加。PIN停止は全移行後の別工程 |

初回はAndroid APK + iOS ad hoc。iOS ad hocは2026/09/21にユーザーが選択済み。Expo/EASは未作成の可能性があるため、[アカウント作成からの手順](../deployment/mobile-internal-first-build-2026-09.md)を追加した。TestFlightを先に使う場合はApp Store Connectアプリ・署名/提出・テスター設定が別途必要。[Expo内部配布](https://docs.expo.dev/build/internal-distribution/) に従い、`preview` はstore/TestFlight用ビルドと混同しない。

`EXPO_PUBLIC_PASSKEY_ENABLED=true` は新ビルド/OTAのUI可否。手元の未設定環境ではSMSを維持する。公開前のビルド配布は行わない。Associated Domainsやネイティブ依存の変更はJS更新だけでは届かない。2026/09/21にユーザーが初回ビルドへのOTA導入を選択し、expo-updates・更新URL・fingerprint runtime・配布channelをローカル設定済み。起動時取得→次のコールド起動で反映し、業務中に強制再起動しない。公開は別途承認。[配布手順](../deployment/mobile-internal-first-build-2026-09.md)を参照。

実行コマンドと検証記録は [mobile README](../../apps/mobile/README.md)。配布用ソースはmain基点の新規チェックアウトへ必要差分を選別し、183必須化/既存駐車差分/今回差分をレビューする。古いignored iosを使わずCNGで生成する。`eas init/build/submit` はこの資料自体を承認とは扱わない。

## 駐車・実機受け入れ

- 前景権限/測位を8秒で打ち切る。最初の新鮮な位置で購読解除、登録が遅れた購読も解除。拒否・OSエラー・古い位置しかない場合は座標なしで退勤/日報へ進む。30秒より古いfixは採用しない。精度不明はnullのまま。
- セッションID由来のclientKeyで再送を同定。「引き渡した」「まだ使う」は座標なし。ホームから後で送る日報に現在地を転用しない。サーバーの駐車保存失敗も日報/退勤とは別結果。
- 実機チェック: iOS/Androidの署名ビルドで、SMS到達→鍵登録→ログアウト→鍵再ログイン、キャンセル/未登録/オフライン、SMS復旧→鍵追加/削除/再認証、Webで作った鍵のアプリ利用と逆方向、端末PINのみ/生体あり、同期なし/別OSを確認。
- 駐車は権限拒否・概算位置・位置OFF・屋内・8秒timeout・背景復帰・再送・GPS成功/精度/時刻を確認。退勤/日報が1回だけ成立し、位置失敗で業務を止めないこと、取得終了後の位置購読解除を確認。
- 再送clientKeyの同一性は駐車履歴の対策。退勤後の日報失敗からホームでやり直す既存経路では駐車座標を復元しない。自動検知/バックグラウンド追跡/写真/位置訂正は別工程。


## ローカル検証結果（2026/09/21）

2026/09/23追記: D-U-N-S待ち、手元はiPhoneのみ。モバイル専用ソース選別/EAS archive照合、両OS prebuild、署名なしiOS実機向けReleaseビルドに成功。承認済みpreview環境2項目をEASへ設定してOTA環境一致を確認。駐車の車両取り違え防止を追加しmobileは14テスト成功。実機署名/配布・認証/OTA/位置送信は未検証。[最新の検証記録](../deployment/mobile-internal-first-build-2026-09.md)を参照。以下は初回時点の記録。

- Webの関連付け/実署名origin/既存WebAuthn・再本人確認/駐車スナップは6ファイル47テスト成功。実EC署名でWeb・iOS/許可Androidを通し、未登録証明書・別origin・UVなし・別RPを拒否した。
- モバイルは2ファイル12テスト成功。OSキャンセル時のverify未送信、登録両APIへの本人確認証明、再本人確認の用途、権限拒否・遅延・古い位置・購読解除失敗、再送キーを確認。
- Web/モバイル/既存管理プレビューの型検査、差分の空白検査に成功。iOSとAndroidのMetro/Hermes export成功（約3.8MBずつ）。これはネイティブコンパイル/署名成功を示さない。
- `check:release` のローカル構成6項目を通過。`--release` はEAS project ID/owner/Apple Team未設定で意図どおり失敗。Androidだけ先行する場合は `--release --platform android` でAppleの未設定を独立させる。
- `http://127.0.0.1:3201/preview/admin/mobile` で本番RNのログイン/設定/駐車選択をDOM表示。1280/768/390/320pxで横はみ出しなし、ロゴ/色/余白/折返しを画像確認。キャンセル→再試行、SMS誤コード→再試行→登録、本人確認後の追加/削除、読込失敗→再取得、長い名前・非対応・本人確認手段なし・読込中、位置あり/なし/引渡しを操作確認。pageerrorなし。
- 操作検証はローカルChrome/Playwrightで実施。Codexアプリ内ブラウザへの表示要求はqueuedで、アプリ内ブラウザそのものの操作確認は未完。RNの実描画とネイティブOSの確認も未完。
- 退勤/日報全体の実API結合、実SMS、Apple/Googleの鍵同期、実機位置送信、EAS archive/native build/署名/配布は未検証。実機確認の対象と承認は上のM-N2以降へ引き継ぐ。
