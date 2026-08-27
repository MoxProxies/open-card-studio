import { api } from "./client";

export interface AuthUser {
  id: number;
  name: string;
  /** Only ever present on the signed-in account's own record — a public
   * profile never carries one (see backend User::$hidden). */
  email: string;
  /** The public handle a profile URL is built from, distinct from `name`. */
  username: string;
  bio: string | null;
  avatar_url: string | null;
  /** Staff see the moderation destination. Presentation only — the
   * moderation API 404s for everyone else regardless. */
  is_staff?: boolean;
}

interface AuthResponse {
  user: AuthUser;
  token: string;
}

const TOKEN_KEY = "card-studio:auth-token:v1";

type Listener = (user: AuthUser | null) => void;
const listeners = new Set<Listener>();

let currentUser: AuthUser | null = null;

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Corrupt/inaccessible localStorage (private browsing, quota, ...) —
    // same fallback spirit as designStorage.ts: treat as logged out
    // rather than throwing.
    return null;
  }
}

function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore — see getToken()
  }
}

function setUser(user: AuthUser | null): void {
  currentUser = user;
  for (const listener of listeners) listener(user);
}

/** Read-only snapshot for a `useSyncExternalStore` selector (see AccountButton.tsx). */
export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

/** Replaces the cached account after a profile edit, so every
 * useSyncExternalStore subscriber re-renders with the new handle/bio. */
export function setCurrentUser(user: AuthUser): void {
  setUser(user);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface SocialProvider {
  id: string;
  label: string;
}

/** Which providers this deployment has configured. Empty is normal — an
 * install with no OAuth credentials simply shows no buttons. */
export async function loadSocialProviders(): Promise<SocialProvider[]> {
  try {
    return await api.get<SocialProvider[]>("/api/auth/providers");
  } catch {
    // A sign-in form that can still take an email and password is better
    // than one that errors because an optional extra didn't load.
    return [];
  }
}

/**
 * Hands the browser to the provider. `redirect_uri` is where the backend
 * sends us back, and it has to be one of that deployment's allowlisted
 * frontend URLs — origin only, no path, so a deep link doesn't have to be
 * separately allowlisted.
 */
export async function startSocialSignIn(provider: string): Promise<void> {
  const { url } = await api.post<{ url: string }>(`/api/auth/${provider}/start`, { redirect_uri: window.location.origin });
  window.location.assign(url);
}

/**
 * Picks a token out of the URL fragment after a provider round-trip, and
 * scrubs it from the address bar and from history.
 *
 * The fragment is where the backend puts it precisely because fragments
 * aren't sent to servers — but it would still sit in the URL bar and in
 * the back stack, so it gets removed immediately. Returns an error code
 * when the provider or the backend refused (a denied consent screen, an
 * unverifiable email).
 */
export function consumeSocialRedirect(): { token?: string; error?: string } {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return {};

  const params = new URLSearchParams(hash);
  const token = params.get("token");
  const error = params.get("error");
  if (!token && !error) return {};

  // replaceState, not pushState: the URL carrying a token should not be
  // somewhere the back button can return to.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);

  if (token) setToken(token);

  return { token: token ?? undefined, error: error ?? undefined };
}

/** Ends every session this account has, not just this browser's. */
export async function logoutEverywhere(): Promise<number> {
  const { sessions_ended } = await api.post<{ sessions_ended: number }>("/api/auth/logout-everywhere");
  setToken(null);
  setUser(null);
  return sessions_ended;
}

export async function register(name: string, email: string, password: string): Promise<AuthUser> {
  const { user, token } = await api.post<AuthResponse>("/api/auth/register", { name, email, password });
  setToken(token);
  setUser(user);
  return user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const { user, token } = await api.post<AuthResponse>("/api/auth/login", { email, password });
  setToken(token);
  setUser(user);
  return user;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/api/auth/logout");
  } catch {
    // The token may already be expired/revoked server-side — still clear
    // it locally either way, that's the part actually under our control.
  }
  setToken(null);
  setUser(null);
}

/**
 * Called once at app startup (AccountButton.tsx's mount effect). A stored
 * token isn't trusted blindly — it's checked against /api/auth/me, so a
 * token the server has since expired/revoked falls back to a clean
 * logged-out state instead of a silently broken "logged in" one where
 * every subsequent request 401s.
 */
export async function restoreSession(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const user = await api.get<AuthUser>("/api/auth/me");
    setUser(user);
    return user;
  } catch {
    setToken(null);
    return null;
  }
}
