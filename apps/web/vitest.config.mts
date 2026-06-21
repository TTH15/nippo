import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const coreSrc = path.resolve(__dirname, "../../packages/core/src");

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
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
    },
  },
});
