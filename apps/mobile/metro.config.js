// Metro × monorepo（npm workspaces）設定。
// ルートの packages/core（@repo/core）を監視・解決できるようにする。
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1) Expo 既定の watchFolders にルート（packages/core 等）を追加して監視
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

// 2) 依存解決にプロジェクトとワークスペース root の node_modules を含める
//    （hierarchical lookup は無効化しない＝Expo 現行の推奨に従う）
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 3) @repo/core の subpath exports（./auth, ./api, ./logic/*）を解決
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
