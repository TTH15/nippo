import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  const owner = process.env.EAS_PROJECT_OWNER;
  const appleTeamId = process.env.APPLE_TEAM_ID;
  if (typeof projectId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) throw new Error("Invalid EAS_PROJECT_ID");
  if (appleTeamId && !/^[A-Z0-9]{10}$/.test(appleTeamId)) throw new Error("Invalid APPLE_TEAM_ID");
  return {
    ...config, name: "ハコ虎", slug: process.env.EAS_PROJECT_SLUG || config.slug || "hakotora",
    ...(owner ? { owner } : {}),
    ios: { ...config.ios, ...(appleTeamId ? { appleTeamId } : {}) },
    runtimeVersion: { policy: "fingerprint" },
    updates: {
      ...config.updates,
      enabled: true,
      url: `https://u.expo.dev/${projectId}`,
      // 更新は次のコールド起動で反映し、入力・退勤操作を中断しない。
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
    },
    extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } },
  };
};
