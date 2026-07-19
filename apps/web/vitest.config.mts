import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const coreSrc = path.resolve(__dirname, "../../packages/core/src");

export default defineConfig({
  plugins: [react()],
  // ルートに hoist された依存(testing-library 等)が Node 解決でルートの react-dom 18
  // (mobile 用)を掴まないよう、変換パイプラインに通して下の resolve.alias を適用する
  ssr: {
    noExternal: [/@testing-library\//],
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    deps: {
      optimizer: {
        client: {
          enabled: true,
          // react を import する外部ライブラリはここへ(外部化されたままだと
          // ルートの react 18 を掴み、hooks/要素型の不一致で落ちる)
          include: [
            "@testing-library/react",
            "@testing-library/user-event",
            "@testing-library/jest-dom",
            "swr",
            "@fortawesome/react-fontawesome",
            "lucide-react",
            "motion",
            "recharts",
            "react-day-picker",
            "@radix-ui/react-popover",
            "@radix-ui/react-slot",
          ],
        },
      },
    },
    // web 配下に加え、移設した @repo/core のテストも拾う
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      `${coreSrc}/**/*.{test,spec}.{ts,tsx}`,
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // @repo/core の subpath（/types, /logic/x, /auth, /api）を core ソースへ解決
      "@repo/core": coreSrc,
      // ルートには mobile(Expo)用の react/react-dom 18 が hoist されているため、
      // テストでは web 配下の 19 系に固定する(18/19 混在ロードで render が壊れる)
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
    },
  },
});
