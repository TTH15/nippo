import { describe, it, expect } from "vitest";
import { isAdminLoginPath } from "./AdminAccessGuard";

// 運営ログイン画面は (admin) 配下にあるためガードに巻き込まれる。
// 除外を誤ると「ログイン画面を開くと /login へ飛ばされて入れない」状態になる。
describe("isAdminLoginPath", () => {
  it("旧運営ログインの転送ページだけを除外する", () => {
    expect(isAdminLoginPath("/admin/login")).toBe(true);
  });

  it("通常の運営ページはガードする", () => {
    expect(isAdminLoginPath("/admin")).toBe(false);
    expect(isAdminLoginPath("/admin/notifications")).toBe(false);
    expect(isAdminLoginPath("/admin/users")).toBe(false);
    expect(isAdminLoginPath("/admin/other/login")).toBe(false);
  });

  it("pathname 未確定でもガード側に倒す（default-deny）", () => {
    expect(isAdminLoginPath(null)).toBe(false);
  });
});
