import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { Palette, Library, LayoutTemplate, BookOpen, User, ShieldAlert } from "lucide-react";
import { getCurrentUser, subscribe } from "../api/auth";
import { GlobalSearch } from "../components/GlobalSearch";
import { navigate, useRoute, type Tab } from "./navStore";

interface Destination {
  tab: Tab;
  label: string;
  icon: ReactNode;
}

/**
 * Five destinations. Deliberately few and fixed: a tab bar people can
 * hit without looking beats a menu that grows every phase. Anything
 * smaller than a destination — save-as-template, report, sign-in — stays
 * a dialog.
 *
 * Ordered Guides, Templates, Design, Library, Profile — the two
 * "look around" destinations lead, Design (where most sessions actually
 * spend their time) sits in the middle, and Library/Profile trail as the
 * "your own stuff" pair.
 */
export const DESTINATIONS: Destination[] = [
  { tab: "guides", label: "Guides", icon: <BookOpen size={22} /> },
  { tab: "templates", label: "Templates", icon: <LayoutTemplate size={22} /> },
  { tab: "design", label: "Design", icon: <Palette size={22} /> },
  { tab: "library", label: "Library", icon: <Library size={22} /> },
  { tab: "profile", label: "Profile", icon: <User size={22} /> },
];

/** The staff-only sixth destination — see navStore. */
const MODERATION: Destination = { tab: "moderation", label: "Moderate", icon: <ShieldAlert size={22} /> };

function useDestinations(): Destination[] {
  const user = useSyncExternalStore(subscribe, getCurrentUser);

  return user?.is_staff ? [...DESTINATIONS, MODERATION] : DESTINATIONS;
}

/** A destination's icon, with the unread-notifications dot pinned to the
 * Profile tab specifically. Notifications moved from a top-bar bell into
 * the Profile page itself (see shell/views/NotificationsView.tsx and
 * AppShell.tsx) — the top bar no longer shows a bell at all, but "new
 * things happened" still needs to be visible without a click, so the one
 * destination that leads there carries the signal instead. */
function DestinationIcon({ destination, unread }: { destination: Destination; unread: number }) {
  if (destination.tab !== "profile" || unread <= 0) return <>{destination.icon}</>;

  return (
    <span style={{ position: "relative", display: "flex" }}>
      {destination.icon}
      <span
        data-testid="profile-tab-unread-badge"
        aria-hidden
        style={{
          position: "absolute",
          top: -2,
          right: -2,
          width: 8,
          height: 8,
          borderRadius: 4,
          background: "var(--cs-accent)",
        }}
      />
    </span>
  );
}

/** Phone: a fixed bottom bar. Thumbs reach the bottom of a phone, not the
 * top, which is why every mobile app puts primary navigation there. */
export function BottomTabs({ unread = 0 }: { unread?: number }) {
  const route = useRoute();
  const destinations = useDestinations();

  return (
    <nav
      data-testid="bottom-tabs"
      style={{
        display: "flex",
        borderTop: "1px solid var(--cs-border)",
        background: "var(--cs-surface)",
        // Clears the home indicator on a notched phone.
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        flex: "none",
      }}
    >
      {destinations.map((d) => {
        const active = route.tab === d.tab;
        return (
          <button
            key={d.tab}
            data-testid={`tab-${d.tab}`}
            data-active={active}
            onClick={() => navigate({ tab: d.tab })}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              // 56px: comfortably over the ~44px minimum touch target.
              minHeight: 56,
              padding: "6px 0",
              border: "none",
              background: "none",
              cursor: "pointer",
              color: active ? "var(--cs-accent)" : "var(--cs-text-muted)",
              fontSize: 12,
            }}
          >
            <DestinationIcon destination={d} unread={unread} />
            {d.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Desktop: a normal website header — brand on the left, nav inline, the
 * account on the right. */
export function TopNav({ account, unread = 0 }: { account: ReactNode; unread?: number }) {
  const route = useRoute();
  const destinations = useDestinations();

  return (
    <header
      data-testid="top-nav"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 16px",
        height: 52,
        borderBottom: "1px solid var(--cs-border)",
        background: "var(--cs-surface)",
        flex: "none",
      }}
    >
      <img src="/icon-192.png" alt="Card Studio" width={30} height={30} style={{ borderRadius: 7, marginRight: 10, flex: "none" }} />

      {destinations.map((d) => {
        const active = route.tab === d.tab;
        return (
          <button
            key={d.tab}
            data-testid={`tab-${d.tab}`}
            data-active={active}
            onClick={() => navigate({ tab: d.tab })}
            className={`cs-btn${active ? " cs-active" : ""}`}
            style={{ border: active ? undefined : "1px solid transparent", background: active ? undefined : "none" }}
          >
            <DestinationIcon destination={d} unread={unread} />
            {d.label}
          </button>
        );
      })}

      <div style={{ flex: 1 }} />
      <GlobalSearch />
      {account}
    </header>
  );
}
