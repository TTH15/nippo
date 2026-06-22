/** @type {import('next').NextConfig} */
const nextConfig = {
  // workspace の TS ソース（@repo/core）を Next がトランスパイルする
  transpilePackages: ["@repo/core"],
};
export default nextConfig;
