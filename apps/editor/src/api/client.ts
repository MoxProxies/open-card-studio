import { getToken } from "./auth";

/**
 * Where the backend (backend/, see root README's "Backend (API)") lives.
 * `VITE_API_BASE_URL` in `.env`/`.env.local` overrides this for anything
 * other than a same-machine dev setup (`php artisan serve`'s default
 * port) — see apps/editor's own README note in the root README.
 */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The refusal's own flags, when it sent any — today just
     * `suspended`, which the app has to tell apart from an ordinary 403
     * (see BlockSuspendedUsers). */
    public body: { suspended?: boolean } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** A refusal because the account is suspended, rather than any other 403. */
export const isSuspendedError = (error: unknown): boolean => error instanceof ApiError && error.body.suspended === true;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    // Laravel's validation/abort responses are JSON with a `message` (and
    // sometimes `errors`) key — fall back to the bare status if the body
    // isn't JSON at all (a proxy/gateway error page, a network tool's
    // interstitial, ...).
    let message = `Request failed (${res.status})`;
    let body: { message?: string; suspended?: boolean } = {};
    try {
      body = (await res.json()) as { message?: string; suspended?: boolean };
      if (body.message) message = body.message;
    } catch {
      // not JSON — keep the generic message
    }
    throw new ApiError(res.status, message, body);
  }

  if (res.status === 204) return undefined as T;

  return (await res.json()) as T;
}

/**
 * The message to show a user for a failed request: the backend's own
 * message when it sent one (a validation error, a 409, a 404 — these are
 * written to be read), otherwise `fallback`, since a raw network/parse
 * error string isn't something to put in front of anyone.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown): Promise<T> => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown): Promise<T> => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),
};
