import { api, isSuspendedError } from "./client";

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
  /** Null until the address is confirmed. Social accounts arrive verified
   * — the provider already proved it. */
  email_verified_at?: string | null;
  /** Staff see the moderation destination. Presentation only — the
   * moderation API 404s for everyone else regardless. */
  is_staff?: boolean;
  /** "ok" or "suspended". Only ever on the account's own record. */
  moderation_state?: string;
  /** False for an account created through a provider that never set a
   * password — it confirms destructive actions by username instead. */
  has_password?: boolean;
  /** Whether a TOTP second factor is on. The secret and recovery codes
   * are never served to anyone, this account included. */
  has_two_factor?: boolean;
}

interface AuthResponse {
  user: AuthUser;
  token: string;
}

/**
 * What a correct password gets you: either a session, or — when the
 * account has a second factor — a challenge to answer with a code.
 */
export type SignInResult = { user: AuthUser } | { challenge: string };

const TOKEN_KEY = "card-studio:auth-token:v1";

type Listener = (user: AuthUser | null) => void;
const listeners = new Set<Listener>();

let currentUser: AuthUser | null = null;
// Signed in, but the account is suspended: not the same state as signed
// out, because the token is still good for exactly one thing — appealing.
let suspended = false;

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

/** Read-only snapshot for useSyncExternalStore, same as getCurrentUser. */
export function getSuspended(): boolean {
  return suspended;
}

/** A suspended account is held signed-out as far as the rest of the app
 * is concerned — every feature would 403 anyway — but the token is kept,
 * because the appeal endpoints are the one thing it still opens. */
function setSuspended(value: boolean): void {
  suspended = value;
  setUser(null);
}

export interface Appeal {
  id: number;
  message: string;
  state: "open" | "granted" | "denied";
  response: string | null;
  submitted_at: string;
  resolved_at: string | null;
}

export const loadAppeal = () => api.get<{ suspended: boolean; appeal: Appeal | null }>("/api/auth/appeal");

export const submitAppeal = (message: string) => api.post<Appeal>("/api/auth/appeal", { message });

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
export function consumeSocialRedirect(): { token?: string; challenge?: string; error?: string } {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return {};

  const params = new URLSearchParams(hash);
  const token = params.get("token");
  // A second factor applies to provider sign-in too, so the backend can
  // send back a challenge where it would otherwise send a token.
  const challenge = params.get("challenge");
  const error = params.get("error");
  if (!token && !challenge && !error) return {};

  // replaceState, not pushState: the URL carrying a token should not be
  // somewhere the back button can return to.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);

  if (token) setToken(token);

  return { token: token ?? undefined, challenge: challenge ?? undefined, error: error ?? undefined };
}

export interface AuthSession {
  id: number;
  /** A rough label for the device the token was issued to — see the
   * backend's DeviceName. "Unknown device" is a normal value. */
  device: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  /** The session this browser is holding. Revoking it is a sign-out. */
  current: boolean;
}

/** Every live token on this account — "what is signed in as me". */
export const loadSessions = () => api.get<AuthSession[]>("/api/auth/sessions");

/** Ends one session. Returns true when it was this browser's, in which
 * case the caller has already been signed out locally. */
export async function revokeSession(id: number): Promise<boolean> {
  const { was_current } = await api.delete<{ was_current: boolean }>(`/api/auth/sessions/${id}`);
  if (was_current) {
    setToken(null);
    setUser(null);
  }
  return was_current;
}

/** Ends every session this account has, not just this browser's. */
export async function logoutEverywhere(): Promise<number> {
  const { sessions_ended } = await api.post<{ sessions_ended: number }>("/api/auth/logout-everywhere");
  setToken(null);
  setUser(null);
  return sessions_ended;
}

/** Starts a password reset. Always resolves — the backend answers
 * identically whether or not the address has an account, and the UI must
 * not imply otherwise. */
export async function requestPasswordReset(email: string): Promise<string> {
  const { message } = await api.post<{ message: string }>("/api/auth/password/forgot", { email });
  return message;
}

export async function resetPassword(input: { token: string; email: string; password: string }): Promise<string> {
  const { message } = await api.post<{ message: string }>("/api/auth/password/reset", {
    ...input,
    password_confirmation: input.password,
  });
  return message;
}

/** Re-sends the confirmation email to the signed-in account. */
export async function resendVerification(): Promise<string> {
  const { message } = await api.post<{ message: string }>("/api/auth/email/verify/send");
  return message;
}

export async function register(name: string, email: string, password: string): Promise<AuthUser> {
  return adoptSession(await api.post<AuthResponse>("/api/auth/register", { name, email, password }));
}

export async function login(email: string, password: string): Promise<SignInResult> {
  const response = await api.post<AuthResponse | { two_factor: true; challenge: string }>("/api/auth/login", { email, password });

  // A second factor turns sign-in into two calls: the password buys a
  // challenge, and completeTwoFactor below spends it.
  if ("two_factor" in response) return { challenge: response.challenge };

  return { user: adoptSession(response) };
}

/** The second half of a sign-in: a challenge from login (or from a
 * provider redirect) plus a code from the authenticator app — or a
 * recovery code, which the backend accepts in the same field. */
export async function completeTwoFactor(challenge: string, code: string): Promise<AuthUser> {
  return adoptSession(await api.post<AuthResponse>("/api/auth/2fa/challenge", { challenge, code: code.trim() }));
}

/** Stores a token and its account — the one place both sign-in paths and
 * registration converge, so the suspension check can't be forgotten on
 * one of them. */
function adoptSession({ user, token }: AuthResponse): AuthUser {
  setToken(token);
  // Signing in works while suspended — deliberately, see the backend's
  // AuthController::login — so the sign-in form's success path is where
  // the suspension surfaces, not an error.
  if (user.moderation_state === "suspended") setSuspended(true);
  else setUser(user);
  return user;
}

export async function logout(): Promise<void> {
  suspended = false;
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
  } catch (e) {
    // A suspension isn't a broken session: the token is still valid, and
    // throwing it away would leave the account unable to appeal.
    if (isSuspendedError(e)) setSuspended(true);
    else setToken(null);
    return null;
  }
}
