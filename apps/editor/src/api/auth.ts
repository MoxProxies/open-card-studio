import { api } from "./client";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
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

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
