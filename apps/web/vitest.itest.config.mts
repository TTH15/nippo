import { defineConfig } from "vitest/config";
import path from "path";
import * as dotenv from "dotenv";

// テストDB（Supabase ブランチ）の接続情報を .env.test.local から読む。
dotenv.config({ path: path.resolve(__dirname, ".env.test.local") });

// 越境テスト（実DBに接続）。既定 unit スイート（*.test.ts）とは分離し、
// ファイル名 *.itest.ts のみを対象にする。creds が無ければ各 suite は describe.skip。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.itest.ts"],
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // 共有DBへ直列で当てる
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
