/** @type {import('next').NextConfig} */
const nextConfig = {
  // workspace の TS ソース（@repo/core と @platform/*）を Next がトランスパイルする
  transpilePackages: ["@repo/core", "@platform/auth", "@platform/api-client"],
  // sharp はネイティブ依存（libvips）を持つ。外部パッケージとして扱わせないと、
  // 関数から .node/.so が見つからず読み込みに失敗する（2026-09-09 に本番で発生）。
  serverExternalPackages: ["sharp", "@gltf-transform/core", "@gltf-transform/extensions"],
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
