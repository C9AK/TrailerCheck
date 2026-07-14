import { useAuthStore } from "@/store/authStore";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Resolve backend-relative media paths (/media/...) to absolute URLs. */
export function mediaUrl(url: string): string {
  return url.startsWith("/") ? `${API_BASE}${url}` : url;
}

/** Multipart upload (QC flag proof). Returns { url, media_type }. */
export async function uploadMedia(file: File): Promise<{ url: string; media_type: "image" | "video" }> {
  const { token } = useAuthStore.getState();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/uploads`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    let detail = `Upload failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* keep generic message */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token, logout } = useAuthStore.getState();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  // 401 on the login endpoint means bad credentials, not an expired session —
  // let it fall through so the server's "Invalid username or password" shows.
  if (res.status === 401 && !path.startsWith("/api/auth/login")) {
    logout();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(401, "Session expired — please log in again.");
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* keep generic message */
    }
    throw new ApiError(res.status, detail);
  }

  return res.json() as Promise<T>;
}
