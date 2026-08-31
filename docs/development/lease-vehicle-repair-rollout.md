# 契約・車両紐付け保存の修繕とmigration 155

2026-08-31 20:31時点の記録。コードとSQLの準備・ローカル検証まで完了。本番／共有開発DBへの接続・SQL適用・デプロイ・通知送信は行っていない。

**後続状況:** ユーザーから本番適用・デプロイ済みとの報告あり（こちらでは実DB照合をしていない）。その後、シフト画面のUIが旧版のままだと判明し、本番ページへの表示変更を別差分で移植した。[シフトUIの変更範囲](shifts-ui-rollout.md) を参照。UIの反映に155の再適用や追加migrationは不要。

## なぜmigrationが必要か

所属会社の検証と保存失敗の表示だけならDB変更は不要。しかし、契約の期間更新・削除・挿入や、車両情報と利用ドライバーの更新を別々のAPIクエリで行うと、途中で失敗した際に一部だけ保存される。この修繕ではDB側の関数にまとめて、失敗した処理全体をロールバックする。

[155_atomic_lease_vehicle_updates.sql](../../supabase/migrations/155_atomic_lease_vehicle_updates.sql) は次の3関数と実行権限だけを追加する。テーブル追加・既存データの一括更新・請求計算の変更は含まない。ファイル全体をトランザクションにし、PostgRESTのスキーマ再読込も通知する。

| 関数 | 用途 |
|---|---|
| `driver_lease_state` | 自社ドライバーの指定日時点の契約、将来契約、履歴全体の変更検知用revisionを取得 |
| `save_driver_lease` | ドライバー行をロックしrevisionを照合。以前の契約を閉じ、同月の設定を置換。後の開始日の予約を維持 |
| `save_vehicle_with_drivers` | 車両の作成／更新と利用ドライバーの変更を一括保存。自社所属と編集開始時の紐付けIDを照合 |

関数は `SECURITY INVOKER`、実行は `service_role` に限定する。ブラウザから直接実行できる権限を与えない。APIの操作権限と、認証済み利用者から取得した会社IDによる所属確認を両方維持する。

## 修繕した動作

- 契約の読取失敗を「リースなし」と扱わない。変更保存に失敗したときは編集を閉じず、入力・エラー・再試行ボタンを残す。成功した基本情報を再送せず、失敗した契約だけ再試行する。新規ドライバー作成後の契約失敗でもドライバーを再作成しない。
- 契約は日本時間の現在日に有効なものを表示する。将来の契約は別表示とし、開始済みの有限期間の契約を取り落とさない。月額／日毎の控除計算と、月単位で設定する運用は変更しない。
- 契約の編集競合は409で止める。「最新の契約を確認」で保存済み内容を確認してから、残った入力で保存する。版情報がない旧クライアントは428で止める。
- シフト通常GET・人数GETの関連データを自社のコース／ドライバー／車両へ限定する。更新・解除でも対象IDの所属確認を省略しない。DB読取エラーを空の正常結果として保存判断に使わない。
- 車両の作成／更新と紐付け保存を一括処理する。編集開始時の紐付けが変わっていれば409で止める。稼働終了者を一覧に表示しない従来仕様を保ちつつ、比較用IDには自社の稼働終了者も含める。モバイルの画像だけの更新は従来どおり紐付けを変更しない。
- 同じ車両を同日に時間帯を分けて使用する運用は維持する。プレビューの日単位の重複禁止を本番APIへ移していない。

## 適用前に確認すること

実環境の適用済みSQLは未確認。migration 062の `driver_leases`、会社ID、現在の車両項目・一意な `(vehicle_id, driver_id)` が必要。後続番号の未適用SQLを一括適用せず、実環境と155の参照する定義を照合する。既存の全件適用スクリプトを本番へ向けて実行しない。

承認された接続先でバックアップと復旧手順を確認し、次の読み取りで不整合の件数を確認する。個人名・電話番号などは取得しない。不整合があれば155に勝手なデータ補正を混ぜず、対象と修復内容を別途確定する。

```sql
-- 同じ開始日の重複。
SELECT count(*) AS duplicate_starts FROM (
  SELECT driver_id, valid_from FROM public.driver_leases
  GROUP BY driver_id, valid_from HAVING count(*) > 1
) x;
-- 不正な期間、月単位運用と異なる既存日付。
SELECT count(*) AS invalid_periods FROM public.driver_leases
WHERE valid_to < valid_from OR extract(day FROM valid_from) <> 1
   OR (valid_to IS NOT NULL AND valid_to <> (date_trunc('month', valid_to) + interval '1 month - 1 day')::date);
SELECT count(*) AS overlapping_pairs FROM public.driver_leases a
JOIN public.driver_leases b ON a.driver_id = b.driver_id AND a.id < b.id
WHERE a.valid_from <= coalesce(b.valid_to, 'infinity'::date)
  AND b.valid_from <= coalesce(a.valid_to, 'infinity'::date);
SELECT count(*) AS future_contracts FROM public.driver_leases
WHERE valid_from > (now() AT TIME ZONE 'Asia/Tokyo')::date;
-- 会社をまたぐ／参照先が欠けている紐付け。
SELECT count(*) AS invalid_vehicle_links FROM public.vehicle_drivers vd
LEFT JOIN public.vehicles v ON v.id = vd.vehicle_id
LEFT JOIN public.drivers d ON d.id = vd.driver_id
WHERE v.id IS NULL OR d.id IS NULL OR v.owner_org_id IS DISTINCT FROM d.org_id;
SELECT count(*) AS invalid_shift_links FROM public.shifts s
LEFT JOIN public.courses c ON c.id = s.course_id
LEFT JOIN public.drivers d ON d.id = s.driver_id
LEFT JOIN public.vehicles v ON v.id = s.vehicle_id
WHERE c.id IS NULL
   OR (s.driver_id IS NOT NULL AND d.org_id IS DISTINCT FROM c.org_id)
   OR (s.vehicle_id IS NOT NULL AND v.owner_org_id IS DISTINCT FROM c.org_id);
```

他社にまたがる既存の車両紐付けは読取時に除外され、編集時にはDB上の全紐付けとの不一致で保存を止める。自動削除して解消しない。

## 公開の順序

1. 本件の対象差分を分離してレビューする。作業ツリーにはUIプレビューなど別の変更があるので、全体をそのまま公開しない。
2. 許可済みの開発／ステージング環境で、実スキーマに155を適用し、権限・代表データ・別接続からの同時編集を確認する。本ターンのメモリ内検証だけで実環境の確認完了とはしない。
3. 本番の対象・バックアップ・不整合件数を確認。対象の契約／車両編集を一時停止し、レビューした155だけを適用する。SQL適用時はエラーで停止する設定を使う。関数定義と実行権限を読み取りで照合する。
4. **155の適用後に**修繕コードを公開する。未適用の場合、契約取得・保存と車両保存は503になり、危険な旧処理には戻らない。旧APIが並行して契約・紐付けを書き込む時間を作らない。
5. 編集していたブラウザを再読み込みする。旧画面にはrevision／紐付け比較情報がない。モバイルの画像単独更新を含め、保存・再取得・競合・権限なし・会社境界を確認して編集を再開する。

中止・復旧時は書き込みを止めて原因を確認する。関数追加だけの段階なら既存データは変わらないが、修繕コードからの保存後は新しい契約履歴を保全する。旧コードへ戻して安全でない更新を再開したり、古いバックアップで新しい保存を無条件に上書きしたりしない。

## 検証と制限

- 2026-08-31の最終結果: Web全96ファイル929テスト（`--maxWorkers=2`）、TypeScript、SQL39項目、独立プレビュービルド、差分の空白確認に成功。PC1440px／スマホ390pxで保存失敗・入力保持・再試行・再表示を確認した。
- APIテストは実際のルートに対して、認証／DBだけを模擬する。会社境界、権限、DBエラー、入力検証、revision必須、未適用時の停止、人数取得、同日共有の互換を確認する。
- 実際のドライバー編集ページをコンポーネントテストし、読取失敗、基本情報だけ成功、入力保持・閉じない・契約だけ再試行、新規登録の二重作成防止、権限なしを確認する。
- `apps/web/src/scripts/checks/lease-vehicle-sql.mjs` はメモリ内PGliteで062と155を実行する。`LEASE_PGLITE_MODULE` で外部の既存PGliteモジュールを指定可能。環境ファイルや本番接続は使用しない。契約期間・将来予約・古いrevision・紐付け比較・所属・実行権限・挿入失敗時のロールバック・再適用を検証する。最小テーブルのため、実環境固有の制約・負荷・複数接続での検証は別途必要。
- [隔離プレビュー](preview-workflow.md)の「契約保存の失敗と再試行」で、共有の部分保存処理とエラー表示をPC／スマホで操作できる。実際の保存先は画面内のみで、DB・認証・実通知とは接続しない。
- 写真のStorageアップロードはDBトランザクションの外にある。所属検証後に行うが、その後のDBエラーで未参照のアップロードが残る可能性はある。既存画像・DBの車両／紐付けが部分更新されることとは区別する。
- 今回は紐付けの競合を検知する。車両の全属性に対する楽観ロック、配車と社外貸出を同時更新する競合、複数便配車の一括保存は対象外。社内受け渡し導入時の要件として継続する。
- 日付付き車両履歴、会社別ラベル、給油・駐車の依頼通知、実返却記録・地図連動の本番導入は、この安全性修繕とは別段階。[本番反映調査](../design/driver-leases-production-rollout.md)の段階3以降を維持する。
