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

