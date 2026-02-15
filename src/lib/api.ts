"use client";

type StoredDriver = { 
  id: string; 
  name: string; 
  role: string;
  companyCode?: string;
  driverCode?: string;
};

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("nippo_token");
}

export function getStoredDriver(): StoredDriver | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("nippo_driver");
  return raw ? JSON.parse(raw) : null;
}

export function setAuth(token: string, driver: StoredDriver) {
  localStorage.setItem("nippo_token", token);
  localStorage.setItem("nippo_driver", JSON.stringify(driver));
}

export function clearAuth() {
  localStorage.removeItem("nippo_token");
  localStorage.removeItem("nippo_driver");
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    clearAuth();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  // Handle CSV or non-JSON
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/csv")) {
    return (await res.blob()) as unknown as T;
  }

  return res.json();
}
