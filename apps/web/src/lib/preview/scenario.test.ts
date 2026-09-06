import { describe, expect, it } from "vitest";
import { buildPreviewHref, parsePreviewLocation, previewDriverFor, PREVIEW_ROLES } from "./scenario";

describe("parsePreviewLocation", () => {
  it("既定は normal / admin", () => {
    expect(parsePreviewLocation("")).toEqual({ scenario: "normal", role: "admin" });
    expect(parsePreviewLocation("?foo=1")).toEqual({ scenario: "normal", role: "admin" });
  });
  it("scenario と role を読む（先頭の ? はあってもなくてもよい）", () => {
    expect(parsePreviewLocation("?scenario=empty&role=viewer")).toEqual({ scenario: "empty", role: "viewer" });
    expect(parsePreviewLocation("scenario=long-name&role=accounting")).toEqual({ scenario: "long-name", role: "accounting" });
  });
  it("不正な値は既定へ倒す", () => {
    expect(parsePreviewLocation("?scenario=../x&role=root")).toEqual({ scenario: "normal", role: "admin" });
    expect(parsePreviewLocation("?scenario=Empty")).toEqual({ scenario: "normal", role: "admin" });
  });
});

describe("buildPreviewHref", () => {
  it("既定値はクエリに出さない", () => {
    expect(buildPreviewHref("/preview/admin/vehicles", { scenario: "normal", role: "admin" })).toBe("/preview/admin/vehicles");
  });
  it("指定があるものだけを付ける", () => {
    expect(buildPreviewHref("/preview/admin/vehicles", { scenario: "empty" })).toBe("/preview/admin/vehicles?scenario=empty");
    expect(buildPreviewHref("/preview/admin/vehicles", { scenario: "empty", role: "viewer" })).toBe("/preview/admin/vehicles?scenario=empty&role=viewer");
  });
  it("既存のクエリは保持し、scenario/role だけ置き換える", () => {
    expect(buildPreviewHref("/preview/admin/shifts", { role: "viewer" }, "?start=2026-09-01&scenario=empty")).toBe("/preview/admin/shifts?start=2026-09-01&role=viewer");
    expect(buildPreviewHref("/preview/admin/shifts?start=2026-09-01", { scenario: "large" })).toBe("/preview/admin/shifts?start=2026-09-01&scenario=large");
  });
});

describe("previewDriverFor", () => {
  it("役割ごとに本番のプリセットロール名と capability を持つ", () => {
    expect(previewDriverFor("admin").role).toBe("ADMIN");
    expect(previewDriverFor("viewer").role).toBe("ADMIN_VIEWER");
    expect(previewDriverFor("viewer").capabilities).not.toContain("can_manage_vehicles");
    expect(previewDriverFor("admin").capabilities).toContain("can_manage_vehicles");
    expect(PREVIEW_ROLES.accounting.capabilities).toContain("can_view_vehicle_cost");
  });
  it("配列は呼び出しごとに複製される（fixture 側で書き換えても定義が汚れない）", () => {
    const a = previewDriverFor("admin");
    a.capabilities.push("x");
    expect(previewDriverFor("admin").capabilities).not.toContain("x");
  });
});
