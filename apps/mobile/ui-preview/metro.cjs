const path = require("node:path");
// 本番のAPI/認証設定には条件分岐を足さず、開発専用Metroだけで差し替える。
module.exports = function withUiPreview(config, root) {
  if (process.env.HAKOTORA_UI_PREVIEW !== "1") return config;
  const mock = name => path.join(root, "ui-preview", name);
  const aliases = {
    "@repo/core/api": mock("services.ts"), "@repo/core/auth": mock("services.ts"),
    "react-native-passkey": mock("native.ts"), "@react-native-ml-kit/text-recognition": mock("native.ts"),
    "expo-image-manipulator": mock("native.ts"), "expo-local-authentication": mock("native.ts"), "expo-location": mock("native.ts"),
  };
  const previous = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, name, platform) => {
    const replacement = filePath => {
      if (context.dev !== true || context.customResolverOptions?.exporting) throw new Error("画面確認のbundleはdev=trueのみ。配布/OTAへ使わないでください");
      return { type: "sourceFile", filePath };
    };
    if (name === "expo-secure-store" && context.originModulePath.endsWith("/src/auth/secureStoreStorage.ts")) return replacement(mock("auth-secure-store.ts"));
    if (name === "./ReportSourceImagePicker" && context.originModulePath.endsWith("/DailyReportForm.tsx")) return replacement(mock("ReportSourceImagePreview.tsx"));
    if (aliases[name]) return replacement(aliases[name]);
    if (name.startsWith("@platform/") || name.startsWith("@repo/core/api/")) throw new Error(`本番サービスの読み込みを遮断: ${name}`);
    const result = previous ? previous(context, name, platform) : context.resolveRequest(context, name, platform);
    if (result.type === "sourceFile") {
      if (result.filePath === path.join(root, "src/bootstrap.ts")) return replacement(mock("services.ts"));
      if (result.filePath === path.join(root, "App.tsx") && context.originModulePath === path.join(root, "index.ts")) return replacement(mock("App.tsx"));
      if (result.filePath.startsWith(path.join(root, "ui-preview") + path.sep)) return replacement(result.filePath);
      if (result.filePath.includes("/packages/api-client/") || result.filePath.includes("/packages/auth/")) throw new Error("本番サービスの読み込みを遮断");
    }
    return result;
  };
  return config;
};
