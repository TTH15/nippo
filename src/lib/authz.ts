export function isAdminViewerRole(role?: string | null): boolean {
  return role === "ADMIN_VIEWER";
}

export function isAdminRole(role?: string | null): boolean {
  return role === "ADMIN";
}

export function canAdminWrite(role?: string | null): boolean {
  return isAdminRole(role);
}

export function canAdminRead(role?: string | null): boolean {
  return role === "ADMIN" || role === "ADMIN_VIEWER";
}

/**
 * シフト編集の権限。ADMIN_VIEWER（閲覧専用アカウント）にも例外的に編集を許可する。
 * Why: 運用上、シフト管理だけは閲覧アカウントからも編集できるようにする運用要件のため。
 *      他の管理機能では `canAdminWrite` を使い続け、閲覧アカウントは読み取り専用のままにする。
 */
export function canEditShifts(role?: string | null): boolean {
  return role === "ADMIN" || role === "ADMIN_VIEWER";
}

