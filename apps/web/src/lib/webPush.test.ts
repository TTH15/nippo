import { describe, it, expect, afterEach, vi } from "vitest";
import { detectPushEnvironment } from "./webPush";

// ============================================================
// Web Push の環境判定。
// iOS Safari のタブでは Push API が存在せず、案内を出し分ける必要がある
// （ホーム画面追加を促すのか、LINE 連携を促すのか）。
// 判定を間違えると「通知をオンにする」ボタンを押しても何も起きない画面になる。
// ============================================================

const originalNavigator = globalThis.navigator;

function setupEnv({
  hasPush,
  userAgent = "Mozilla/5.0",
  platform = "Win32",
  maxTouchPoints = 0,
  standalone = false,
}: {
  hasPush: boolean;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}) {
  vi.stubGlobal("navigator", {
    userAgent,
    platform,
    maxTouchPoints,
    serviceWorker: hasPush ? {} : undefined,
    standalone,
  });

  const windowStub = {
    matchMedia: () => ({ matches: standalone }),
    navigator: { standalone },
    ...(hasPush ? { PushManager: class {}, Notification: class {} } : {}),
  };
  vi.stubGlobal("window", windowStub);
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalNavigator) vi.stubGlobal("navigator", originalNavigator);
});

describe("detectPushEnvironment", () => {
  it("Push API がある環境は supported", () => {
    setupEnv({ hasPush: true });
    expect(detectPushEnvironment()).toBe("supported");
  });

  it("ホーム画面に追加した iOS は supported（Push API が提供される）", () => {
    setupEnv({
      hasPush: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      platform: "iPhone",
      standalone: true,
    });
    expect(detectPushEnvironment()).toBe("supported");
  });

  it("iOS Safari のタブは ios_needs_install（ホーム画面追加を案内する）", () => {
    setupEnv({
      hasPush: false,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      platform: "iPhone",
      standalone: false,
    });
    expect(detectPushEnvironment()).toBe("ios_needs_install");
  });

  it("iPadOS はUAがMacを名乗るため、タッチ数で iOS と判定する", () => {
    setupEnv({
      hasPush: false,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 5,
      standalone: false,
    });
    expect(detectPushEnvironment()).toBe("ios_needs_install");
  });

  it("Push API が無い非 iOS は unsupported（案内を出さない）", () => {
    setupEnv({ hasPush: false, userAgent: "Mozilla/5.0 (Windows NT 10.0)", platform: "Win32" });
    expect(detectPushEnvironment()).toBe("unsupported");
  });

  it("タッチ無しの Mac は iOS 扱いしない", () => {
    setupEnv({
      hasPush: false,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 0,
    });
    expect(detectPushEnvironment()).toBe("unsupported");
  });
});
