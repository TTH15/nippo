# 設計書の入口

更新: 2026/09/28。設計書には採用した方針、未実装の提案、過去の検討が混在する。**現在の画面・APIの挙動はコード、DBは[スキーマ](../database-schema.md)、本番公開の境界は[公開前確認](../deployment/fleet-location-report-release-2026-09.md)を優先**する。ここで「現行」とした文書も、全機能の本番公開を意味しない。

## 現行フローを調べる

| 領域 | 最初に読む文書 | 補足 |
| --- | --- | --- |
| 管理画面の構成・ダッシュボード | [管理画面の情報設計](../admin-information-architecture.md)、[ページ境界と車両地図](admin-ia-fleet-dashboard-2026-09.md) | メニュー再編の実装と、ページ統合の未実装案を区別する |
| シフトメモ | [日別人数](shift-memo-required-count-exceptions-2026-09.md)、[正式シフトへの反映](shift-memo-reflect-2026-09.md) | 個人・共有モードの保存境界は[管理画面の情報設計](../admin-information-architecture.md#シフトメモの保存境界) |
| 稼働・撮影・駐車 | [開始・終了撮影と駐車](mobile-capture-parking-lifecycle-2026-09.md)、[公開前確認](../deployment/fleet-location-report-release-2026-09.md) | 日報先行、退勤時の点検4方向、駐車時のメーターが新しい順序 |
| 日報画像 | [画像原本・読取](report-image-evidence-2026-09.md)、[モバイル日報](mobile-photo-report-2026-09.md) | 旧順序の節は履歴として読む |
| 認証・配布 | [認証の適用状態](security-b1-b8-2026-09.md)、[Passkeyと配布](mobile-passkey-distribution-2026-09.md)、[初回配布手順](../deployment/mobile-internal-first-build-2026-09.md) | 署名済み配布・実機確認は別ゲート |
| APIとハコ虎AI | [API・権限一覧](../development/api-permissions.md)、[AIの入口と権限境界](hakotora-ai-entry.md) | AI画面・MCPは構想段階 |

## 分野別の設計・進行中の案

| 分野 | 文書 | 現在の扱い |
| --- | --- | --- |
| 業務・シフト | [仕事の統合モデル](work-model.md)、[コースの便](course-cycle.md)、[モバイルのシフト](mobile-shifts-2026-09.md)、[事前の事故検知](operational-risk-detection-2026-09.md) | 採用方針と段階別の実装案。各文書の未実装項目を確認する |
| 車両・地図 | [地図作戦盤](map-board.md)、[地図の使い勝手](map-board-usability-2026-09.md)、[受け渡し・通知](vehicle-handoffs-and-notifications.md)、[車検証登録・3Dモデル](vehicle-registration-and-models-2026-09.md)、[車両移動モード](mobile-vehicle-move-2026-09.md) | 長期案・試作・実装が混在。現行ダッシュボードは上の入口を優先 |
| モバイル体験 | [3Dホーム](mobile-home-3d-2026-09.md)、[3D素材ブリーフ](mobile-home-3d-asset-brief.md)、[撮影操作](mobile-capture-interaction-2026-09.md)、[マイページ](mobile-my-page-2026-09.md)、[オンボーディング](onboarding-passkey-2026-09.md) | 画面試作と採用方針。古い画面構成は履歴として読む |
| 記録・文書 | [会社別の記録フォーム](org-record-forms.md)、[文書プラットフォーム](document-platform.md) | 前者は現行基盤、後者は承認済みの未実装方針 |
| 収支・契約 | [リースとラベル](driver-leases-and-labels.md)、[本番反映調査](driver-leases-production-rollout.md)、[税務単価](money-tax-basis.md)、[単価ルールと月次確定](rate-rules-and-monthly-closing.md)、[単価適用日](rate-effective-date.md)、[プランと課金](plans-and-billing.md)、[元請け・下請け](prime-sub-reports.md) | 決定記録と提案。実装・公開状況は個別に確認する |
| その他 | [ハコ虎 Base](hakotora-base-2026-09.md)、[テナントファイルと請求書住所](tenant-files-invoices-2026-09.md) | アプリ構想／セキュリティの作業記録 |

## 過去の検討・画像記録

以下は後続の方針に置き換わった部分があり、現在の操作順や公開状態の根拠にしない。

| 文書 | 置き換わった点・用途 |
| --- | --- |
| [日報起点の駐車基盤](daily-report-parking-foundation.md) | 当初は日報と駐車を同時送信。現在は独立した駐車記録も扱う |
| [駐車の自動特定](mobile-parking-auto-detect.md) | 当初の単発測位・検知案。背景測位を駐車完了まで続ける現行方針を優先 |
| [地図UIの再検討](map-ux.md) | ダッシュボード統合前の比較・理由を残す |
| [シフト上の車両位置UI](shift-vehicle-location-ui.md)、[画像生成記録](shift-vehicle-location-ui-prompts.md) | 静止画による初期案。画面の正本ではない |
| [車両3DのBlenderメモ](vehicle-3d-blender.md) | モデル制作時の検討記録 |
| [案件記録・日払いの旧案](response-records.md) | 固定項目案は廃止。本文は[履歴](archive/response-records-2026-08.md) |
| [判断待ちの旧一覧](decisions-pending.md) | 2026年8月のスナップショット。本文は[履歴](archive/decisions-pending-2026-08.md) |

画像・画面検証の証跡は[素材・スクリーンショット](assets/)に置く。画像だけを現行仕様の根拠にせず、対応する文書の更新日とコードを照合する。過去案を追加するときは、冒頭に「現行／提案／履歴」と置き換え先を記す。

## 現在の判断待ちを探す

2026年8月の[旧一覧](archive/decisions-pending-2026-08.md)をそのまま現在のタスクリストとして使わない。少なくとも次の判断は後続資料に残っている。

| 論点 | 現行の参照先 |
| --- | --- |
| GPS履歴の保存・削除期間、駐車しない場合の測位停止上限、点検写真の例外、稼働途中の撮影ルール変更 | [車両位置・日報・駐車の公開前確認](../deployment/fleet-location-report-release-2026-09.md#公開前に決めること) |
| AIを最初に使う人、外部へ渡すデータ、書き込み時の確認、OAuth/MCPの公開範囲 | [ハコ虎AIの入口](hakotora-ai-entry.md#公開前の判断) |
| ハコ虎 Base の初回業務範囲・共有端末の利用者切替・識別子 | [ハコ虎 Base](hakotora-base-2026-09.md) |
| プラン価格などの経営判断 | [プランと課金](plans-and-billing.md) |
