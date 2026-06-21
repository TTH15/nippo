export type AuthUser = {
  driverId: string;
  role: "DRIVER" | "ADMIN" | "ADMIN_VIEWER";
  companyCode: string;
};

export interface AuthProvider {
  verify(authHeader: string | null): Promise<AuthUser>;
}
