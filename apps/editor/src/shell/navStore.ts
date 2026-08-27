import { useSyncExternalStore } from "react";

/**
 * Where you are in the app. Five destinations, the way a phone app has
 * four or five tabs — see AppShell.tsx for why the big surfaces
 * (profiles, the gallery, guides) are destinations rather than modals.
 * Staff get a sixth; everyone else never sees it, and the API 404s for
 * them regardless, so hiding it is presentation rather than the security
 * boundary.
 */
export type Tab = "design" | "library" | "templates" | "guides" | "profile" | "moderation";

export interface Route {
  tab: Tab;
  /** Whose profile — unset means the signed-in account's own. */
  username?: string;
  /** Which guide is open, by slug — unset means the index. */
  slug?: string;
}

const DEFAULT: Route = { tab: "design" };

/**
 * Routes are mirrored into the URL hash so a profile or a guide can be
 * linked to and survives a reload. A hash rather than real paths: this
 * app is served as a static bundle that can sit at any base path (its own
 * domain, a subdirectory, a preview URL), and a hash needs no server-side
 * rewrite to work in all of them.
 */
export function toHash(route: Route): string {
  if (route.tab === "profile" && route.username) return `#/u/${route.username}`;
  if (route.tab === "guides" && route.slug) return `#/guides/${route.slug}`;

  return `#/${route.tab}`;
}

export function fromHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);

  if (parts[0] === "u" && parts[1]) return { tab: "profile", username: decodeURIComponent(parts[1]) };
  if (parts[0] === "guides") return parts[1] ? { tab: "guides", slug: decodeURIComponent(parts[1]) } : { tab: "guides" };

  const tabs: Tab[] = ["design", "library", "templates", "guides", "profile", "moderation"];
  const tab = tabs.find((t) => t === parts[0]);

  return tab ? { tab } : DEFAULT;
}

let current: Route = DEFAULT;
/**
 * Bumped on every navigate(), including re-selecting the destination
 * you're already on. AppShell keys the view container by it, so tapping
 * the current tab remounts and refetches — the behaviour every app has,
 * and the only way to see that something you're looking at changed
 * elsewhere (a moderator removed it, a second tab published it).
 */
let epoch = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Called once at startup, and again on every back/forward. */
export function syncFromLocation(): void {
  current = fromHash(window.location.hash);
  epoch += 1;
  emit();
}

export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  current = route;
  epoch += 1;
  const hash = toHash(route);

  // Only touch history when the hash actually changes, so re-selecting the
  // tab you're already on doesn't stack duplicate back-button entries.
  if (window.location.hash !== hash) {
    if (options.replace) window.history.replaceState(null, "", hash);
    else window.history.pushState(null, "", hash);
  }

  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => current);
}

/** See `epoch` — for keying a view so re-selecting its tab refreshes it. */
export function useNavEpoch(): number {
  return useSyncExternalStore(subscribe, () => epoch);
}
