import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT } from "jose";
import { signToken, SimpleJwtAuthProvider } from "./jwt";

// jwt.ts は process.env.JWT_SECRET を要求する
beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-for-jwt-roundtrip";
});

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET!);
const provider = new SimpleJwtAuthProvider();

describe("signToken / verify (Phase 6a: identity_id + current_org_id)", () => {
  it("新トークンは identityId/orgId を往復する", async () => {
    const token = await signToken({
      driverId: "drv-1",
      role: "DRIVER",
      companyCode: "ACE",
      identityId: "idn-1",
      orgId: "org-1",
    });
    const user = await provider.verify(`Bearer ${token}`);
    expect(user).toMatchObject({
      driverId: "drv-1",
      role: "DRIVER",
      companyCode: "ACE",
      identityId: "idn-1",
      orgId: "org-1",
    });
  });

  it("identityId/orgId 未指定なら null で発行・検証される", async () => {
    const token = await signToken({ driverId: "drv-2", role: "ADMIN", companyCode: "ACE" });
    const user = await provider.verify(`Bearer ${token}`);
    expect(user.identityId).toBeNull();
    expect(user.orgId).toBeNull();
  });

  it("後方互換: identity_id/current_org_id を持たない旧トークンも検証でき null になる", async () => {
    // 6a 以前の発行形（identity_id / current_org_id クレーム無し）を再現
    const legacy = await new SignJWT({ sub: "drv-3", role: "DRIVER", companyCode: "ACE" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(secret());
    const user = await provider.verify(`Bearer ${legacy}`);
    expect(user.driverId).toBe("drv-3");
    expect(user.companyCode).toBe("ACE");
    expect(user.identityId).toBeNull();
    expect(user.orgId).toBeNull();
  });

  it("不正な role は弾く", async () => {
    const bad = await new SignJWT({ sub: "drv-4", role: "HACKER", companyCode: "ACE" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(secret());
    await expect(provider.verify(`Bearer ${bad}`)).rejects.toThrow();
  });
});
