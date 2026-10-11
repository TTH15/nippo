# 共有メモ・日報表示の限定リリース（2026/10/11）

基点は公開済み main `23bbb44a9b2189248468bb4473a3d8d878a1c2e5`。元の未コミット作業を保持して専用checkoutへ今回の4点だけを切り出した。ユーザーが本番反映を承認した範囲は、共有シフトメモ同期、候補の名前札の非表示・復元、日報車両番号、オイル／使用不可の表示層である。

- 共有メモ: 正本・現在の編集・送信snapshot・セッション世代を分離。古いGET/PATCHを拒否し、保存中の追加編集を保持。真の競合は全ローカル値を残して解決させ、収束済み変更は成功とする。人員移動は全変更の照合後に送信し、成否不明の保存はGETで確認する。初期取得はcourses変更で再実行しない。pendingは最後の保存で解消する。
- 復旧・編集者: 正本は既存の認証済みAPIで取得。15秒の可視時pollとfocus/online/再接続で復旧。Presence/Broadcastは名前・セル・revisionの通知だけを使い、遅い参加・同じセルへの再接続・retry・退出・notesを補う。未送信draftはセッションごとに端末へ保持する。
- 非表示: `hiddenPeople`の候補だけを隠す。配置済み札・正式シフト・ドライバー登録を変更しない。札選択ボタンとPCのdrop、既存SmoothCollapseの復元一覧を使う。
- 日報番号: 紐付け車両の実番号を優先。未紐付け時は実際の報告値、または会社・人・日・コース・template versionを照合した唯一の原本を表示する。複数report/cycle/原本は推測で対応させない。確認済み訂正値と未確認OCRは別表示。番号の保存が無い場合は未登録、読取失敗は番号確認待ちとする。現在の車両設定から過去番号を補わず、番号だけで車両登録を作らない。
- 警告: VehiclePlate内にisolationを追加し、oil/使用不可のz-indexを日付ヘッダー・固定列の背面へ閉じ込める。tooltipのportalは維持する。

## 検証

- Web全206ファイル1745テスト成功（maxWorkers=2）。共有・番号・車両の関連8ファイル71テスト成功。
- Web、preview、mobile、base型チェック成功。会社境界78表の静的検査成功。実環境を読まないplaceholderによるWeb webpackビルド成功。
- ネットワーク無効の使い捨てPostgres17で8検査成功: legacy/runtimeの権限不変、非表示永続化、入力validation、actor/company guard、競合人員移動の全体未保存、row lock並行更新。
- 本番コンポーネントの隔離fixtureでPC1280／768／390／320、2タブ、候補非表示・復元・日付切替・reload・閲覧のみ、保存中の追加編集、notes競合解決、遅れて参加した編集者、警告の縦横scrollを確認。新しい公開checkoutでもPC1280と390／320で番号6ケース・権限・警告・共有非表示／復元／同期済みを再確認。console error/warnなし。実Supabase接続での2人の業務書込は未実施。

## DB限定適用

`shared_shift_memo_hidden_people`を本番へ適用。既存RPCが既知のmap一覧3箇所・path・FOR UPDATEを持つ場合だけ関数本体を更新し、未知定義なら停止する。旧定義は適用前に保存済み。変更前hash `5d2142956fd30e06541feaf39dba3b72` →変更後 `b236406f7a7675542dfbab8e98b85eee`。

適用後もowner postgres、SECURITY INVOKER、ACL postgres/service_role EXECUTE、search_path public、表RLS on/FORCE offが完全一致。runtime関数は本番に存在せず作成していない。既存データ変更・grants・認証・鍵・環境設定・業務API分離は実施していない。新コードを戻しても追加mapは既存配置を壊さず保持できる。

## 隔離プレビュー

`npm run preview:admin -- admin --port 3199`。

- `/preview/admin/shifts?scenario=shared-live&role=admin`: シフトメモ→共有。shared-slow／shared-missed／shared-lost-responseも用意。
- `/preview/admin/shifts?scenario=plate-overlap&role=admin`: 警告と固定header。
- `/preview/admin/daily?scenario=vehicle-number&role=admin`: 未紐付け番号6ケース。viewerで書込ボタンが無いことを確認。

全値は架空。認証・DB・外部通知はfixtureへ置換する。
