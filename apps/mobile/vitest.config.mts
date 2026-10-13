import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: [{ find: /^@repo\/core\/logic\/(.+)$/, replacement: fileURLToPath(new URL("../../packages/core/src/logic/", import.meta.url)) + "$1.ts" }] },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
