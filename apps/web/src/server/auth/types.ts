export type AuthUser = {
  driverId: string;
  role: "DRIVER" | "ADMIN" | "ADMIN_VIEWER";
  companyCode: string;
  // Phase 6a: identity（人）/ membership（所属=driver 行）分離の土台。
  // 旧トークン（6a 以前に発行）には無いため nullable。orgId の解決権威は当面 DB（resolveOrgId）のまま。
  identityId: string | null;
  orgId: string | null;
};

export interface AuthProvider {
  verify(authHeader: string | null): Promise<AuthUser>;
}
