# B-7/B-8・日報移行案内の先行公開計画

2026/09/17 18:36の残タスク整理に基づく。目的は、**PIN停止（B-6）を公開せずに**、Passkey管理の本人確認強化、日報からのSMS確認/Passkey登録案内、依存更新を先行公開すること。

## 公開へ含める

| 区分 | 対象 | 理由 |
|---|---|---|
| DB | `supabase/migrations/166_passkey_management_notice.sql` | `manage_passkey` RPC。鍵追加/削除と本人通知を同一トランザクションで確定する。Web公開前に適用する |
| Web API | `apps/web/src/app/api/auth/reauth/*` | 5分以内のSMS/Passkey本人確認を発行・検証する |
| Web API | `apps/web/src/app/api/me/passkeys/route.ts` | 自分のPasskey一覧・削除。RPC166に依存する |
| Web API | `apps/web/src/app/api/auth/webauthn/register/verify/route.ts` | 登録時に直近本人確認を要求し、RPC166で保存・通知する |
| Web API | `apps/web/src/app/api/me/login-setup/route.ts`、`apps/web/src/app/api/me/phone/send/route.ts`、`apps/web/src/app/api/me/phone/verify/route.ts` | 日報からSMS確認→Passkey登録へ進むための本人向け状態取得・送信・検証 |
| Web UI | `apps/web/src/lib/components/RecentAuth.tsx`、`PasskeyManagement.tsx`、`LoginSetupPrompt.tsx`、関連テスト | Passkey追加/削除と日報内の移行案内 |
| Web UI | `apps/web/src/app/(user)/submit/SubmitPageClientV2.tsx`、関連テスト | 日報入力を維持したまま移行案内を表示する |
| Auth基盤 | `apps/web/src/server/auth/recentAuth.ts`、`reauthIdentity.ts`、`phoneEnrollment.ts`、`jwt.ts`、`types.ts`、`webauthn.ts`、関連テスト | 再確認トークン、強い認証時刻、reauth用challengeを支える |
| 通知 | `apps/web/src/server/notifications/dispatch.ts` | RPC166で保存した本人通知を既存LINE/Push経路へ渡す |
| 依存 | `package.json`、`package-lock.json`、`apps/web/package.json` | B-8の監査0件化。React/Expoの固定方針を守る |
| プレビュー/文書 | 日報・アカウント・復旧系fixture、`docs/design/security-b1-b8-2026-09.md`、`docs/development/preview-workflow.md` | 隔離プレビューと公開手順の再現性 |

## 公開から除外する

| 区分 | 対象 | 理由 |
|---|---|---|
| DB | `supabase/migrations/167_retire_driver_pin.sql` | 移行不足を検知するガード付きPIN停止。active DRIVERの移行不足が残るため今回は未適用 |
| Web API | `apps/web/src/app/api/auth/login/route.ts` のdriver PIN停止部分 | そのまま出すと既存PIN利用者が再ログイン不能になる |
| Web UI | `apps/web/src/app/login/page.tsx` のPIN欄撤去、`apps/web/src/app/login/page.test.tsx` | B-6。旧PIN利用者の移行完了後に公開 |
| Mobile | `apps/mobile/App.tsx`、`apps/mobile/src/screens/LoginScreen.tsx`、`MeScreen.tsx`、`app.json`、`eas.json`、`bootstrap.ts` | B-6/内部配布準備。EAS projectId・資格情報・実機SMS/Passkey確認前に混ぜない |
| 管理API | `apps/web/src/app/api/admin/users/*` の新規PIN発行停止のみの差分 | B-6。B-7表示用のSMS/Passkey状態取得と混同しない |
| 申請/招待 | `apps/web/src/app/join/OnboardingWizard.tsx`、`apps/web/src/app/login/recover/page.tsx` のPasskey半必須化 | 先行公開の主対象は既存利用者の日報案内。招待導線はB-6境界と絡むため別差分で再検証 |
| 車両/シフト | migration 164/165、車両GLB/車検証読取、シフトメモ正式反映 | 別トラック。認証先行公開に混ぜない |

## 作業順

1. 本番公開済み基点（現状は `aa40e2d`）から専用作業ツリーを作る。
2. 上の「含める」だけを適用し、B-6や車両/シフトの差分が混ざっていないことを `git diff --name-status` で確認する。
3. 開発DBまたは一時DBで166を検証し、本番適用手順と戻し方を再確認する。166は旧Webに影響しないため、Web公開前に適用できる。
4. Web側は関連テスト、Web/プレビュー型、tenant検査、Node.js 24の本番ビルド、`npm audit --omit=dev` を実行する。
5. 隔離プレビューで `/preview/admin/submit?scenario=normal`、`/preview/admin/account?scenario=empty|lastkey|nofactor|unavailable`、`/preview/admin/recover?scenario=normal` をPC/スマホ幅で確認する。
6. 公開前に追加で、strict CSP下のPDF実保存、地図、OCRページ起動を確認する。B-5の過去PDF確認と混同しない。
7. 本番は166適用→Web公開→ログイン/日報/Passkey管理/未認証API/停止利用者の確認の順で進める。

## 完了条件

- PINログインの停止・PIN欄撤去・mobileのPIN廃止は本番へ出ていない。
- 日報画面で、SMS未確認/Passkey未登録の本人が日報入力を失わずにSMS確認とPasskey登録へ進める。
- Passkey追加/削除は、5分以内のSMSまたはPasskey本人確認なしでは通らない。
- 最後のPasskey削除、他人/他社/停止済み、通知保存失敗、同時削除を拒否または全体取消できる。
- npm監査は0件。Web/preview型・tenant検査・対象テスト・本番ビルドが通る。

## 未完として残す

- active DRIVER全員のSMS確認/Passkey移行、旧モバイル移行、EAS内部配布、実SMS到達、実端末Passkey登録。
- `167_retire_driver_pin.sql` とB-6の公開。
- 招待登録のPasskey半必須化を同時に出すかどうかの最終判断。
- GitHub main同期のpush承認とApp CI。
