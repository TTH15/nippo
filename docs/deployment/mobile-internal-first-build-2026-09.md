# ハコ虎：初回内部配布の準備手順

2026/09/21、ユーザー指定: Expo/EASは未作成の可能性があるため作成から整理し、iOSは少数端末のad hoc配布とする。当初は外部操作未実行だったが、下記の範囲をユーザー指定で完了した。各段階で対象/影響を提示して承認を得る。

## 2026/09/21 21:59 実施済み

- ユーザーがExpoアカウントと対象projectを作成し、UUID `c874c3eb-642e-4670-8706-31e47e821d76` の紐付けを明示指示。
- `codex plugin add expo@openai-curated` 成功（manifest 1.0.2、cache 11c74d6b）。導入されたskillsを確認。Expo MCP接続はこの作業に含めていない。
- EAS CLI 24.7.0をnpxで取得し、ユーザーがExpo公式ブラウザ画面でCLI認証を完了。
- 既存の `apps/mobile` を利用するため、提示された `create-expo-app hakotora` は新規ひな形用として省略。既存コード/未コミット差分を保持。
- `init --id c874c3eb-642e-4670-8706-31e47e821d76 --non-interactive --no-icon` と `project:info` に成功。`@next-eight/hakotora` とUUID一致を確認し、owner/project IDを `app.json` に保存。ダッシュボード画像は送信しなかった。
- `check:release --release --platform android` 成功。Apple Team/UDID・署名・関連付け公開・build/submit・DB変更は未実施。以下の手順はステップ3以降へ進む。

## 2026/09/21 22:04 読み取り確認と更新方式

- 対象 `@next-eight/hakotora` の `build:list --platform all --limit 5 --non-interactive --json` は空配列。EASビルド履歴はまだない。
- `device:list --json --non-interactive` は `No Apple teams found for account next-eight`。ExpoにApple Teamが未登録のため端末一覧は取得できない。Apple Developer契約の有無・Apple側の既存端末/証明書の有無は、この結果では判断できない。
- `credentials` は管理用の対話コマンドであり、今回は署名の作成/変更へ進んでいない。Apple Team候補 `R7Z5XNJAY9` の採用も未確定。
- 調査時点では `expo-updates`、更新URL、runtimeVersion、配布channelが未設定だった。その後、ユーザーが初回ビルドへのOTA導入を選択し、下記をローカル実装した。端末登録・EASへの紐付けだけでは自動更新されない。

### OTA更新（ユーザー選択済み・ローカル実装済み・公開前）

1. 初回署名ビルドにSDK互換の `expo-updates` を含め、更新URLを今回のEAS projectへ固定する。`preview` と `production` のchannelを分ける。
2. ネイティブ互換性を `runtimeVersion: { policy: "fingerprint" }` で判定する。同じOS・channel・runtimeにだけ更新を届ける。ネイティブ依存、権限、Associated Domainsなどが変わる場合は新しい署名ビルドを配布する。
3. 起動時に更新を非同期取得し、取得済み更新は次のコールド起動で反映する。ホームへの復帰や別アプリからの復帰だけでは必ず反映されない。日報入力・撮影・SMS確認・退勤操作中の強制リロードは行わない。通信不可時はインストール済み/取得済み版で起動する（業務APIのオフライン対応を意味しない）。
4. `eas update` は公開操作として対象差分・OS・channel・runtime・環境を提示して別途承認する。ビルドの `eas.json` の `env` がそのままOTA公開に適用されるとは扱わず、`--environment` で使うEAS環境のAPI URL/Passkeyフラグをビルド時と照合する。
5. 初回配布で、更新なし/取得成功/通信失敗/次回起動/異なるruntime/入力中に更新公開した場合を実機確認する。問題時の更新差し戻しも対象と影響を確認して実施する。

Web/API側だけの変更はサーバー公開で反映できる。OTAで届けるのは互換性のあるJavaScript・アセット。署名/provisioning profileの更新や新規端末の追加をOTAで代替することはできない。「毎回必ず最新版」は保証しない。

根拠: [Expoの更新取得と反映](https://docs.expo.dev/eas-update/download-updates/)、[runtimeの互換性](https://docs.expo.dev/eas-update/runtime-versions/)、[EAS Update導入](https://docs.expo.dev/eas-update/getting-started/)。

実装: SDKの指定範囲 `expo-updates@~57.0.22`（lockは57.0.23）、動的configの更新URL/runtime/起動方針、EAS各profileのchannel、配布前チェック4項目を追加。EAS上のchannel作成・更新公開は行っていない。

ユーザー回答ではApple Developer Programは「未登録・確認が必要」。[Apple Developerアカウント](https://developer.apple.com/account/)でMembership detailsとTeamを確認する。未加入なら[公式登録手順](https://developer.apple.com/programs/enroll/)から本人が登録する。法人名義の場合は組織としての登録条件を確認し、加入形態や有料契約を代理決定しない。契約有効化後、実際のTeam IDを確定してUDID登録へ進む。ローカル候補だけを採用しない。

## 2026/09/23 Apple登録待ちに進める範囲

- ユーザーはD-U-N-S番号の発行待ち。Apple側の登録/Team/UDID/署名は待ちとし、候補Teamを仮採用しない。検証端末は現状iPhoneのみ。Androidは配布準備までとし、実機合格にはしない。
- Expo `preview` environmentの読み取り結果は変数0件。build profileにあるAPI URL・PasskeyフラグをOTAでも使うには、次の2項目をproject scopeで揃える必要がある。

| 外部設定案 | 値 | 影響 |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | `https://hakotora.jp` | 今後preview向けにビルド/OTA公開するコードのAPI接続先 |
| `EXPO_PUBLIC_PASSKEY_ENABLED` | `true` | 同じビルド/OTAのPasskey UI有効化 |

対象は `@next-eight/hakotora` / UUID `c874c3eb-642e-4670-8706-31e47e821d76` の `preview` だけ。値は公開設定なのでplaintext。設定自体はビルドやOTAを配布しない。本番Web/DB・production/development環境の変更は含めない。次のコマンドはこの外部設定への承認後に実行する。

```sh
npx eas-cli@latest env:set preview --scope project --name EXPO_PUBLIC_API_BASE_URL --value https://hakotora.jp --type string --visibility plaintext --non-interactive
npx eas-cli@latest env:set preview --scope project --name EXPO_PUBLIC_PASSKEY_ENABLED --value true --type string --visibility plaintext --non-interactive
```

`check:release --ota --platform android` で、読み込んだAPI/Passkey環境とprofileを照合する。値なし・別API・別projectは失敗する。EAS環境を変更しただけでこのシェルへ取り込まれるわけではないため、公開用シェルに対象環境を読み込んでからチェックする。

配布元の選別は `scripts/prepare-mobile-release.mjs` を追加。元のdirty treeを保持し、mobile・変更のない共有packages・依存manifestだけを別ディレクトリへコピーする。[READMEの実行手順](../../apps/mobile/README.md)を参照。

### 00:11 実施・検証結果

- 上記2変数はユーザー承認後にproject scope/previewへ作成済み。EAS `env:exec preview` で取得した値を使い、`check:release --ota --release --platform android` 全14項目が成功。production/development、DB/Web、署名、EASビルド、OTA公開は変更していない。
- 選別コピーへ `npm ci` 成功。mobile型検査・14テスト成功。配布候補は135ファイル・約1.6MB、EAS `build:inspect --stage archive` の出力がmanifestの全パス/SHA-256と一致。基点commitは `1259eb64ebfcc90176138cca98ed749eba9c50e3`。未コミットmobile差分を含むため基点commitだけを配布版と扱わずmanifestも保持する。
- 両OSの `expo prebuild --no-install --platform all` 成功。iOSのAssociated Domainsと両OSのOTA設定が生成された。元リポジトリの旧iosは未変更。React Native 0.86.0に対するExpo推奨patch 0.86.3、Androidのexpo-system-ui未導入の警告は残り、自動upgradeはしていない。
- CocoaPods導入成功（128 pods）。Xcode 26.6で `Release / iphoneos / generic platform iOS / CODE_SIGNING_ALLOWED=NO` のビルド成功。bundle `jp.hakotora.app`、表示名ハコ虎、version 0.1.0、min iOS16.4を生成物で確認。最終候補のmobileソース/config/lockfileとコンパイル入力のSHA-256一致も確認。
- Apple Siliconシミュレーター向けはOCR依存の `EXCLUDED_ARCHS[sdk=iphonesimulator*] = arm64` により失敗（CocoaPods embedのARCHS空）。それを回避するため本番のOCRを外したり、依存を変更したりはしていない。シミュレーター起動・実機インストール/署名・Passkey/OTA/GPSの実機検証は未完。
- Androidのネイティブコンパイルは未実施（ローカルJava Runtime/adbなし、Android実機なし）。EASへ送信しての検証は別途承認する。
- 退勤の位置を日報で選んだ別車両へ付ける可能性を修正。セッション車両IDを保持し、不一致なら駐車情報を送らず日報を継続。14テストのうち2件がこの回帰確認。隔離プレビューの1280/390/320pxで同一車両・別車両・GPSなしを操作確認。Chrome/Playwrightでpageerror/横はみ出しなし、画像確認済み。Codexアプリ内ブラウザ表示はqueuedで、同ブラウザ自体での操作確認は未完。

署名なし実機向け生成物は `/tmp/hakotora-ios-device-build-20260923/Build/Products/Release-iphoneos/app.app`、ログは `/tmp/hakotora-ios-device-build-20260923.log`。このappは未署名なのでiPhoneへ配布できない。Apple登録後は確定Team・UDID・Associated Domains・サーバーAASA/DALを確認した上でEASの署名ビルドを作る。

今回の最終ソースは `/tmp/hakotora-mobile-release-20260923/source`、選別manifestは同ディレクトリの隣の `manifest.json`、照合済みEAS archiveは `/tmp/hakotora-mobile-release-archive-20260923`。いずれも一時ディレクトリなので公開前に存続/hashを確認し、消えていればREADMEの手順で作り直して再レビューする。ネイティブ生成/Pods導入を行った検証用コピーとは分けている。

### 画面調整のための追記（2026/09/23）

上記00:11の成果物は、その時点の依存を対象にした履歴。後続の画面確認でExpo GoとのWorklets不一致が判明し、RN0.86.3 / Reanimated4.5.1 / Worklets0.10.1へ統一した。旧候補・旧署名なしappを最新の検証済み成果物として配布しない。更新後の選別コピーではnpm ci・型・テスト・JS exportを検証し、ネイティブコンパイルは配布前に再検証する。

[Fast Refreshの手順](../development/mobile-fast-refresh.md)で本番APIから隔離した実画面をExpo Go上で調整できる。これはPasskey/GPS/OCRの実機検証や内部配布の完了を意味しない。

## 1. Expoアカウントを用意する（ユーザー操作）

1. [Expoの登録ページ](https://expo.dev/signup) で、継続して管理できるメールアドレスのPersonalアカウントを作る。すでにある場合はログインし、既存projectを確認する。
2. 会社で管理するため、ダッシュボードからOrganizationを作る。候補名はハコ虎、owner名候補は `hakotora`。空き状況によってowner名だけ変えてよい。アプリ表示名・bundle IDは変えない。
3. メール確認・二段階認証を済ませ、復旧コードは本人の安全な場所に保管する。パスワード・復旧コード・アクセストークンをチャットへ貼らない。
4. ここで共有するのは **owner名** と、既存projectがあった場合のproject名/UUIDだけ。Organizationの料金プランや有料ビルドを無断で申し込まない。

[Expo公式のアカウント種別](https://docs.expo.dev/accounts/account-types/) は、チームで使う場合のOrganization作成を推奨している。

## 2. EAS projectを作成・紐付けする（対象確認後に実行）

| 値 | 今回の候補/固定値 |
|---|---|
| owner | 上で作成/確認したOrganization |
| project slug | `hakotora`（既存があれば既存slug） |
| 表示名 | ハコ虎 |
| iOS bundle / Android package | `jp.hakotora.app` |
| 初回profile | `preview` |
| API | `https://hakotora.jp`（本番へ書き込むため実機操作も承認後） |

選別したクリーンなチェックアウトを用意し、`apps/mobile` から操作する。EAS CLIは公式版を導入し、実行時のバージョンを記録する。ログインはユーザー本人が行う。

```sh
npx eas-cli@latest login
npx eas-cli@latest whoami
npx eas-cli@latest init
```

`init` の対話で承認済みownerを選ぶ。既存projectが見つかればそれを照合して紐付け、新規作成を重複させない。作成/紐付け後にproject UUIDとslugを記録する。動的 `app.config.ts` へCLIが自動追記できない場合は返された値を設定する。

`EAS_PROJECT_ID` / `EAS_PROJECT_OWNER` / 必要なら `EAS_PROJECT_SLUG` をローカルのEAS実行環境およびEASの該当environmentに設定する。公開識別子だが誤ったprojectへ送らないよう `eas project:info` とExpo configで突き合わせる。EASの環境設定変更も承認対象。

```sh
npx eas-cli@latest project:info
```

この段階ではまだbuild/submitしない。[Expo初回ビルド手順](https://docs.expo.dev/build/setup/)、[EAS CLI](https://docs.expo.dev/eas/cli/)を参照。

## 3. Appleと検証iPhoneを確認する

1. 有効なApple Developer Program契約、利用できるTeam、Certificates/Identifiers/Profilesの操作権限を確認する。過去資料の契約待ち状態やローカルXcodeの候補 `R7Z5XNJAY9` だけでは判定しない。
2. `jp.hakotora.app` のApp IDを確認/作成し、Associated Domainsを有効にする。作成・capability変更は別途承認する。`APPLE_TEAM_ID` を設定する。
3. 最初の検証者・端末台数・端末所有者を確定する。UDIDのApple/Expoへの登録先を確認してから以下を実行し、対象iPhoneで登録URLを開く。

```sh
npx eas-cli@latest device:create
npx eas-cli@latest device:list
```

4. Expoへの端末登録だけではAppleのprofileに入らない。ビルド時にAppleへログインし、その端末を含むad hoc provisioning profileを生成/更新する。新しい端末を足す場合もprofile更新/再署名または再ビルドが必要。
5. 署名profileのapplication-identifierからApp ID prefixを確認する。サーバーAASAの `PASSKEY_APPLE_APP_ID` を `<prefix>.jp.hakotora.app` に設定する。

初回はTestFlight提出・App Store掲載・審査へ進まない。[Expoの端末登録とad hoc](https://docs.expo.dev/build/internal-distribution/)、[Appleのad hoc profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile)を参照。

## 4. Androidの署名とサーバーを準備する

Android初回はEASのpreview APKで配布するため、Google Playのアプリ作成/提出は不要。署名keystoreを作成または既存から選ぶ操作は承認後に行う。

1. `jp.hakotora.app` に使用するAPK署名証明書のSHA-256指紋を取得する。秘密鍵本体をリポジトリ・チャットへ置かない。
2. サーバーの `PASSKEY_ANDROID_SHA256_CERT_FINGERPRINTS` にその指紋を設定する。DALとAndroid認証originはこの同じ値から生成される。
3. iOSのAASAとAndroidのDAL・サーバーorigin変更を公開する。新規招待必須化も含める場合はmigration 183→Webの順に別途承認/適用する。
4. `https://hakotora.jp/.well-known/apple-app-site-association` と `https://hakotora.jp/.well-known/assetlinks.json` が200・JSON・redirectなしで、承認したApp ID/指紋だけを含むことを確認する。

## 5. 最初のビルド・配布

配布用チェックアウトで以下を完了してから、送信先owner/projectと対象コミットを提示する。

```sh
npm ci
npm run typecheck -w @repo/mobile
npm run test -w @repo/mobile
npm run check:release -w @repo/mobile -- --release
```

EASへ送るアーカイブは既存dirty tree・本番 `.env` ・資格情報・ignoredな古いios/Podsを含めない。ビルドは新規生成したネイティブプロジェクトを使う。署名の作成/保存とビルド料金の影響を確認し、承認後に `apps/mobile` で実行する。

```sh
npx eas-cli@latest build --profile preview --platform android
npx eas-cli@latest build --profile preview --platform ios
```

完成した配布URLは許可した検証者にだけ共有する。iPhoneは登録済み端末でインストール、Androidは配布APKをインストールする。リンクのアクセス設定も確認する。対象端末を増やす/ドライバー17名へ広げるのは実機確認後の別承認。

## 6. 実機で合格にする条件

SMS到達→パスキー登録→ログアウト→パスキー再ログイン、キャンセル→SMS復旧、新端末で鍵追加/紛失鍵削除、画面ロックPINのみの利用、Webとの鍵共有を確認する。SMS未確認の既存10名はWeb/PINセッションから先にSMS確認する。

業務開始→退勤日報で、位置成功/拒否/8秒待機上限/精度不明/再送を確認する。位置が取れなくても退勤と日報が成立することが必須。本番の検証用利用者・車両・日付・通知影響は実行前に確定する。

端末紛失時、SMS復旧や鍵削除だけでは古いJWTは失効しない。運営の本人確認と既存セッション失効を別に行う。[認証・復旧設計](../design/mobile-passkey-distribution-2026-09.md)を参照。PIN停止は移行完了後まで行わない。
