import { useAuthStore } from "@/store/authStore";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Resolve backend-relative media paths (/media/...) to absolute URLs. */
export function mediaUrl(url: string): string {
  return url.startsWith("/") ? `${API_BASE}${url}` : url;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// R14 retry interceptor — the Render free instance sleeps when idle and takes
// ~30-60s to wake, surfacing as network errors / timeouts / 502-504 from the
// load balancer. Retry up to 3 times with increasing delays instead of
// failing the first request, and toast the user so they don't spam refresh.
// ---------------------------------------------------------------------------
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [3_000, 5_000, 8_000]; // up to 3 retries
const ATTEMPT_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastWakeToastAt = 0;

/** Fire the global toast (dashboard layout + login page listen for it),
 *  throttled so one cold start produces one toast, not one per retry. */
function notifyWakingUp() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastWakeToastAt < 15_000) return;
  lastWakeToastAt = now;
  window.dispatchEvent(
    new CustomEvent("tc-toast", {
      detail: { msg: "Waking up secure connection, please wait...", tone: "warn" },
    })
  );
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (RETRYABLE_STATUS.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
        notifyWakingUp();
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      return res;
    } catch {
      // Network error or per-attempt timeout — typical while Render wakes up.
      if (attempt < RETRY_DELAYS_MS.length) {
        notifyWakingUp();
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new ApiError(
        0,
        "Unable to reach the server — please check your connection and try again."
      );
    }
  }
}

/** Multipart upload (QC flag proof). Returns { url, media_type }.
 *  No retry/timeout here: large video uploads legitimately run long, and
 *  blindly re-sending a body that may have landed risks duplicates. */
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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token, logout } = useAuthStore.getState();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchWithRetry(`${API_BASE}${path}`, { ...init, headers });

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

  // 204 No Content (e.g. DELETE) has an empty body — res.json() would throw
  // and make a SUCCESSFUL delete look like a failure in the UI.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
