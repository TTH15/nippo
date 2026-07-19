import { describe, it, expect } from "vitest";
import { checkPermission, type Grants } from "./policy";
import { OWN_PERMISSIONS, type Capability, type OwnPermission } from "./capabilities";

// スコープ付き権限判定（own / any）の不変条件。
// ハコ虎AI のツール実行ガードも同じ checkPermission を使う前提のため、
// 「updateShift はできるが他人には不可」がここで担保されていることが重要。

const grants = (opts: { caps?: Capability[]; own?: OwnPermission[]; worksAsDriver?: boolean }): Grants => ({
  capabilities: new Set(opts.caps ?? []),
  ownPermissions: new Set(opts.own ?? []),
  worksAsDriver: opts.worksAsDriver ?? false,
});

describe("checkPermission", () => {
  const me = "driver-1";
  const other = "driver-2";

  it("any capability を持てば org 全体スコープで許可される", () => {
    const g = grants({ caps: ["can_manage_shifts"] });
    expect(checkPermission(g, me, { any: "can_manage_shifts", ownerDriverId: other })).toEqual({
      allowed: true,
      scope: "any",
    });
  });

  it("own 権限は対象が本人のときだけ許可される", () => {
    const g = grants({ own: ["own_manage_shift_requests"] });
    expect(checkPermission(g, me, { own: "own_manage_shift_requests", ownerDriverId: me })).toEqual({
      allowed: true,
      scope: "own",
    });
  });

  it("own 権限では他人のリソースは拒否される（ハコ虎AI の updateShift 制約）", () => {
    const g = grants({ own: [...OWN_PERMISSIONS] });
    expect(checkPermission(g, me, { own: "own_manage_shift_requests", ownerDriverId: other })).toEqual({
      allowed: false,
    });
  });

  it("ownerDriverId 省略は「本人が対象」とみなす", () => {
    const g = grants({ own: ["own_view_shifts"] });
    expect(checkPermission(g, me, { own: "own_view_shifts" })).toEqual({
      allowed: true,
      scope: "own",
    });
  });

  it("own 権限を持たなければ本人対象でも拒否される", () => {
    const g = grants({});
    expect(checkPermission(g, me, { own: "own_submit_reports" })).toEqual({ allowed: false });
  });

  it("any と own の両指定では any が優先され、他人対象も any で通る", () => {
    const g = grants({ caps: ["can_manage_shifts"], own: ["own_manage_shift_requests"] });
    expect(
      checkPermission(g, me, {
        any: "can_manage_shifts",
        own: "own_manage_shift_requests",
        ownerDriverId: other,
      }),
    ).toEqual({ allowed: true, scope: "any" });
  });

  it("any を持たず own のみなら、両指定でも own スコープに縮退する", () => {
    const g = grants({ own: ["own_manage_shift_requests"] });
    expect(
      checkPermission(g, me, { any: "can_manage_shifts", own: "own_manage_shift_requests" }),
    ).toEqual({ allowed: true, scope: "own" });
  });

  it("該当権限を何も持たなければ拒否される", () => {
    const g = grants({ caps: ["can_view_reports"] });
    expect(checkPermission(g, me, { any: "can_manage_shifts", own: "own_manage_shift_requests", ownerDriverId: other })).toEqual({
      allowed: false,
    });
  });
});

describe("own permission catalog", () => {
  it("own 権限に重複が無い", () => {
    expect(new Set(OWN_PERMISSIONS).size).toBe(OWN_PERMISSIONS.length);
  });

  it("own 権限は own_ プレフィックスで capability(can_) と衝突しない", () => {
    for (const p of OWN_PERMISSIONS) {
      expect(p.startsWith("own_")).toBe(true);
    }
  });
});
