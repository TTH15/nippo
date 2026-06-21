# Step 0: monorepo化（構造のみ）移行プラン

ステータス: 計画（ブランチ `chore/monorepo-step0` 上で具体化）／作成: 2026-06-21

## 0. このStepのゴールと非ゴール

**ゴール**: 稼働中のWebアプリを壊さずに、リポジトリを monorepo 構造へ作り替える。
ネイティブ（Expo）と基盤移行（マルチテナント）の双方を後続でunblockし、`nippo-mvp` 名からの脱却（ディレクトリ/パッケージ名）も同時に済ませる。

**非ゴール（このStepでは触らない）**:
- DBスキーマ・マイグレーション（基盤移行は別Step）
- アプリのふるまい・UI・ロジックの変更
- Expoアプリ本体の実装（足場は次Step）
- サービス名/ドメインの最終決定（名前は後から差し替え可能にしておくだけ）

**大原則**: 全工程は「ファイル移動＋設定の再配線」のみ。コード本体は不変。各フェーズで `build`＋`test` が緑であることを確認してから次へ。本番（main）にマージする前に Vercel preview で確認。

---

## 1. 目標ディレクトリ構造

```
<repo>/                         ← package.json は workspaces ルートに
├─ apps/
│  └─ web/                      ← 現 Next.js アプリ一式（src/core を除く）
│     ├─ src/
│     │  ├─ app/ config/ lib/ scripts/ server/ test/
│     ├─ public/
│     ├─ next.config.mjs
│     ├─ tsconfig.json
│     ├─ tailwind.config.ts
│     ├─ postcss.config.js
│     ├─ vitest.config.mts
│     └─ package.json           ← Next依存・scripts
├─ packages/
│  └─ core/                     ← 現 src/core を昇格（Web/RN共有）
│     ├─ src/                   ← types/ auth/ api/ logic/
│     ├─ tsconfig.json
│     └─ package.json           ← name: "@repo/core"
├─ supabase/                    ← 据え置き（移動しない）
├─ docs/                        ← 据え置き
├─ package.json                 ← workspaces ルート（{ "workspaces": ["apps/*","packages/*"] }）
└─ package-lock.json            ← ルートで一元管理
```

### パッケージ名について
共有層は `@repo/core` とする（中立名。サービス名が確定したら一括 rename 可能）。
将来 `apps/mobile`（Expo）が同じ `@repo/core` を import する。

---

## 2. フェーズ分割（コミット単位）

「mainに直接コミットしない」練習も兼ね、**フェーズごとに1コミット**。各コミット後に `build`＋`test` 緑を確認。

### Phase 0-A: monorepo骨格 ＋ Webアプリ移設
Next.js アプリ一式を `apps/web/` へ移す。**import文は一切変えない**（`@/*` → `./src/*` の相対関係は維持されるため）。

手順:
1. ルートに `apps/web/` を作成
2. `git mv` で以下を `apps/web/` へ:
   - `src/`（※この時点では `src/core` も一緒に web 配下へ移動。Phase 0-B で packages へ再昇格）
   - `public/`
   - `next.config.mjs` `tsconfig.json` `tailwind.config.ts` `postcss.config.js` `vitest.config.mts`
   - `next-env.d.ts`
3. ルート `package.json` を **workspacesルート** に作り替え:
   - `"workspaces": ["apps/*", "packages/*"]`
   - 依存・scripts は `apps/web/package.json` 側へ移す
   - ルート scripts は委譲（例: `"dev": "npm -w apps/web run dev"`, `"build": "npm -w apps/web run build"`, `"test": "npm -w apps/web run test"`）
4. `apps/web/package.json` を新設:
   - name は `@repo/web`（or `web`）。現 `dependencies`/`devDependencies`/`scripts` をここへ
5. `apps/web/tsconfig.json` の `paths` は `"@/*": ["./src/*"]` のまま（web基準で不変）
6. `apps/web/tailwind.config.ts` の content `./src/**/*` のまま（web基準で不変）
7. `apps/web/vitest.config.mts` の alias `@ → ./src` のまま、setupFiles パスも web 基準で不変
8. ルートで `npm install`（workspaces リンク生成）
9. **検証**: `npm run build` ＋ `npm test`（現240テスト）が緑

この時点で **Webは完全に従来どおり動作**（import 無改変）。Vercel の Root Directory を `apps/web` に変えれば本番もそのまま。

### Phase 0-B: core を packages/core へ昇格
共有層を独立パッケージにし、Expo から import 可能にする。

手順:
1. `git mv apps/web/src/core` → `packages/core/src`
2. `packages/core/package.json` 新設:
   ```json
   {
     "name": "@repo/core",
     "version": "0.0.0",
     "private": true,
     "main": "./src/index.ts",
     "types": "./src/index.ts",
     "exports": {
       ".": "./src/index.ts",
       "./types": "./src/types/index.ts",
       "./auth": "./src/auth/index.ts",
       "./api": "./src/api/index.ts",
       "./logic/*": "./src/logic/*.ts"
     }
   }
   ```
   （TSソースのまま消費。ビルド不要。Next/Metro 双方がトランスパイルする）
3. `packages/core/tsconfig.json` 新設（web から extends できる base か、独立した最小設定）
4. **型リークの解消**（唯一の越境 `@/server/reportKinds/fields`）:
   - core が必要とする純粋型 `FieldType / FieldRole / FieldOption / ReportField / VehicleMode / AnswerAttachment` を
     `packages/core/src/types/reportFields.ts` へ移設
   - `apps/web/src/server/reportKinds/fields.ts` はそれらを `@repo/core/types` から **import して再export**
     → 既存の `@/server/reportKinds/fields` 経由 import（15ファイル）は**無改変**
   - core 側 `types/report.ts` / `logic/report.ts` の `@/server/...` 参照を内部参照へ変更
     → これで core の外部越境がゼロになる
5. **import の再配線**（`@/core` → `@repo/core`、対象は外部参照の9ファイルのみ）:
   - `src/app/(user)/submit/SubmitPageClientV2.tsx`
   - `src/app/(user)/me/rewards/page.tsx`
   - `src/app/(user)/me/page.tsx`
   - `src/app/(user)/shifts/page.tsx`
   - `src/app/api/admin/users/license-alert-count/route.ts`
   - `src/app/api/admin/vehicles/oil-alert-count/route.ts`
   - `src/app/(admin)/admin/(resource)/users/page.tsx`
   - `src/lib/api.ts`
   - `src/lib/components/VehiclePlate.tsx`
   - （`@/core/types` → `@repo/core/types`、`@/core/logic/x` → `@repo/core/logic/x` 等、機械的置換）
6. `apps/web/next.config.mjs` に `transpilePackages: ["@repo/core"]` を追加（workspace のTSをNextがコンパイルするため）
7. `apps/web/vitest.config.mts` の alias に `"@repo/core": packages/core/src` を追加（テストが解決できるよう）
8. core のテスト（`*.test.ts`）は core と一緒に `packages/core/src` へ移動。vitest は両方を拾えるよう設定（ルート集約 or web設定の include 調整）
9. **検証**: `npm run build` ＋ `npm test`（全テスト緑、件数が移行前後で一致）

### Phase 0-C: 仕上げ
1. ルート `tsconfig.json`（あれば）/ ルート README の更新
2. `.gitignore` の確認（`.next` などのパスが apps/web 基準になるか）
3. ディレクトリ名のリネーム（`nippo-mvp` → 新名）は **repo フォルダ名の変更**で対応（任意・最後に）

---

## 3. リスクと対策

| リスク | 対策 |
|---|---|
| Webの本番デプロイが壊れる | ブランチ作業＋Vercel preview で確認後にmainマージ。Vercel Root Directory=apps/web の設定変更が必要（下記§5） |
| `@/core`→`@repo/core` の置換漏れ | 対象は9ファイルと限定的。grep で全消化を確認＋`tsc`/build で検出 |
| 型リークでcoreがビルド不能 | Phase 0-B-4 で型を core 側へ移し再export。`import type` のみなので実行影響なし |
| テスト件数の取りこぼし | 移行前 `npm test` の件数を記録し、移行後に一致を確認 |
| vitest/Next が `@repo/core` を解決できない | vitest=alias追加、Next=transpilePackages追加で両対応 |

---

## 4. 検証チェックリスト（各フェーズ後）

- [ ] `npm install` がエラーなく完了（workspaces リンク）
- [ ] `npm run build`（= apps/web の next build）成功
- [ ] `npm test` 緑、テスト件数が移行前と一致
- [ ] `git grep "@/core"` の残りが core 内部のみ（外部参照ゼロ）
- [ ] `git grep '"@/server/reportKinds/fields"'` の参照が壊れていない（再export経由）

---

## 5. 手動作業（私が代行できないもの）

**Vercel の設定変更（Phase 0-A マージ前後）**:
1. Vercel ダッシュボード → 該当プロジェクト → Settings → General
2. **Root Directory** を `apps/web` に設定
3. （必要なら）Build/Install Command がルート前提なら確認。workspaces なら通常はそのままでよい
4. preview デプロイで動作確認 → 問題なければ main へ

env var / ドメイン / GitHub連携はそのまま（プロジェクト再作成は不要）。

---

## 6. 次Step（このStep完了後）

- `apps/mobile`（Expo）足場を追加し `@repo/core` を import → 「歩く骨格」1画面
- 並行で基盤移行（マルチテナント Phase0-2: organizations/org_id/スコープ一元化）
- 参照: `platform-overview.md` §7 推奨順序
</content>
</invoke>
