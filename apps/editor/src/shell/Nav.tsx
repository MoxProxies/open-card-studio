import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { Palette, Library, LayoutTemplate, BookOpen, User, ShieldAlert } from "lucide-react";
import { getCurrentUser, subscribe } from "../api/auth";
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
 */
export const DESTINATIONS: Destination[] = [
  { tab: "design", label: "Design", icon: <Palette size={20} /> },
  { tab: "library", label: "Library", icon: <Library size={20} /> },
  { tab: "templates", label: "Templates", icon: <LayoutTemplate size={20} /> },
  { tab: "guides", label: "Guides", icon: <BookOpen size={20} /> },
  { tab: "profile", label: "Profile", icon: <User size={20} /> },
];

/** The staff-only sixth destination — see navStore. */
const MODERATION: Destination = { tab: "moderation", label: "Moderate", icon: <ShieldAlert size={20} /> };

function useDestinations(): Destination[] {
  const user = useSyncExternalStore(subscribe, getCurrentUser);

  return user?.is_staff ? [...DESTINATIONS, MODERATION] : DESTINATIONS;
}

/** Phone: a fixed bottom bar. Thumbs reach the bottom of a phone, not the
 * top, which is why every mobile app puts primary navigation there. */
export function BottomTabs() {
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
              fontSize: 10,
            }}
          >
            {d.icon}
            {d.label}
          </button>
        );
      })}
    </nav>
  );
}

/** Desktop: a normal website header — brand on the left, nav inline, the
 * account on the right. */
export function TopNav({ account }: { account: ReactNode }) {
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
      <span className="cs-heading" style={{ fontSize: 16, fontWeight: 600, marginRight: 10 }}>
        Card Studio
      </span>

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
            {d.icon}
            {d.label}
          </button>
        );
      })}

      <div style={{ flex: 1 }} />
      {account}
    </header>
  );
}
