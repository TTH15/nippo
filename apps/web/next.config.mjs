/** @type {import('next').NextConfig} */
const nextConfig = {
  // workspace の TS ソース（@repo/core と @platform/*）を Next がトランスパイルする
  transpilePackages: ["@repo/core", "@platform/auth", "@platform/api-client"],
  // 車両登録時にサーバーでナンバープレートの GLB を作る（src/server/vehicles/plateModel.ts）。
  // 字形の SVG とプレートの無地の型は fs で読むため、関数へ同梱されるよう明示する。
  outputFileTracingIncludes: {
    "/api/admin/vehicles/**": [
      "./public/number_plate/**",
      "./src/server/vehicles/plate-blanks/**",
    ],
  },
};
export default nextConfig;
