/** @type {import('next').NextConfig} */
const nextConfig = {
  // workspace の TS ソース（@repo/core と @platform/*）を Next がトランスパイルする
  transpilePackages: ["@repo/core", "@platform/auth", "@platform/api-client"],
};
export default nextConfig;
