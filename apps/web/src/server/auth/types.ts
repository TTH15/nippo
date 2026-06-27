// membership のロール。ACCOUNTING(経理) は migration 091 で DB に追加。
// org が作るカスタムロール(roles.key=CUSTOM_xxxxx)も入りうるため string も許容
//（既知値は補完を効かせつつ任意文字列を受ける）。権限の実体は role の束＝capability
//（§2-6 / server/auth/capabilities.ts）で、role テキストは表示ラベル。
export type MembershipRole = "DRIVER" | "ADMIN" | "ADMIN_VIEWER" | "ACCOUNTING" | (string & {});

export type AuthUser = {
  driverId: string;
  role: MembershipRole;
  companyCode: string;
  // Phase 6a: identity（人）/ membership（所属=driver 行）分離の土台。
  // 旧トークン（6a 以前に発行）には無いため nullable。orgId の解決権威は当面 DB（resolveOrgId）のまま。
  identityId: string | null;
  orgId: string | null;
};

export interface AuthProvider {
  verify(authHeader: string | null): Promise<AuthUser>;
}
