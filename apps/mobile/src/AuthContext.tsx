import { createContext, useContext } from "react";
import type { StoredDriver } from "@repo/core/auth";

// 認証済みエリア（タブ）配下で driver / logout を共有する。
// navigator の screen は props を直接受け取れないため Context で渡す。
type AuthValue = { driver: StoredDriver; logout: () => void };

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used within <AuthContext.Provider>");
  return v;
}
