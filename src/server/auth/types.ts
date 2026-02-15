export type AuthUser = {
  driverId: string;
  role: "DRIVER" | "ADMIN";
  companyCode: string;
};

export interface AuthProvider {
  verify(authHeader: string | null): Promise<AuthUser>;
}
