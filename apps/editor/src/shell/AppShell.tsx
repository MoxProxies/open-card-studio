import { useEffect, useState, useSyncExternalStore } from "react";
import { LogIn, X } from "lucide-react";
import { createEmptyDesign, STANDARD_CARD_SIZE_MM } from "@card-studio/scene-schema";
import { App } from "../App";
import { AccountModal } from "../components/AccountModal";
import { DesignInspiration } from "../components/DesignInspiration";
import { GlobalSearch } from "../components/GlobalSearch";
import { ResetPasswordModal } from "../components/ResetPasswordModal";
import { SuspendedNotice } from "../components/SuspendedNotice";
import { TwoFactorPrompt } from "../components/TwoFactorPrompt";
import { loadNotifications } from "../api/notifications";
import { consumeSocialRedirect, getCurrentUser, getSuspended, restoreSession, subscribe } from "../api/auth";
import { apiDesignStorage } from "../api/apiDesignStorage";
import { localStorageDesignStorage, setActiveDesignStorage } from "../designStorage";
import { useIsNarrow } from "../hooks/useIsNarrow";
import { useDesignStore } from "../store/DesignProvider";
import { randomUUID } from "../uuid";
import { BottomTabs, TopNav } from "./Nav";
import { navigate, syncFromLocation, useNavEpoch, useRoute } from "./navStore";
import { LibraryView } from "./views/LibraryView";
import { TemplatesView } from "./views/TemplatesView";
import { GuidesView } from "./views/GuidesView";
import { ProfileView } from "./views/ProfileView";
import { ModerationView } from "./views/ModerationView";

/**
 * The standalone app: an editor plus the community around it, structured
 * the way an app is — a handful of destinations you navigate between
 * (Nav.tsx), not a canvas with everything else stacked on top of it in
 * dialogs. Bottom tab bar on a phone, a website-style top nav above
 * 768px (useIsNarrow.ts). Dialogs are still dialogs, for the things that
 * genuinely are one: signing in, saving a template, filing a report.
 *
 * **The embed doesn't use any of this.** `<card-studio-editor>` renders
 * <App/> alone, keeps its own toolbar buttons and its own dialogs, and is
 * unaffected by everything here — a host page embedding the editor has
 * its own navigation and doesn't want ours. That's why the panels are
 * chrome-free (see components/TemplatesPanel.tsx): one implementation,
 * rendered as a page here and as a dialog there.
 *
 * main.tsx passes `hideLocalDesignLibrary` when it builds the store, so
 * the editor's own Designs/Templates/account buttons stay hidden here —
 * they'd be a second, competing copy of this shell's navigation.
 */
export function AppShell() {
  const route = useRoute();
  const epoch = useNavEpoch();
  const narrow = useIsNarrow();
  const user = useSyncExternalStore(subscribe, getCurrentUser);

  // The Design tab's inspiration screen (components/DesignInspiration.tsx):
  // shown in place of the canvas for a design nobody has touched yet.
  // "Untouched" reuses state the store already tracks rather than a new
  // parallel flag — a design fresh out of createEmptyDesign has no layers
  // and no undo history (same `past.length` Toolbar.tsx already reads for
  // canUndo), and every mutating store action pushes onto `past` before
  // this ever renders again, so the screen gets out of the way the moment
  // there's anything to look at.
  //
  // That alone can't tell "still blank because nothing's happened yet"
  // apart from "blank because the user just chose to start blank" —
  // both leave layers/past exactly where createEmptyDesign left them. So
  // this also remembers *which* design id was explicitly dismissed
  // (starting blank, or picking a template here) — cleared implicitly the
  // moment a different design loads (a different id just doesn't match),
  // which is also why a genuinely new blank design (the toolbar's own
  // "New") shows this screen again: it mints a fresh id this component
  // has never seen dismissed.
  const designId = useDesignStore((s) => s.design.id);
  const hasLayers = useDesignStore((s) => s.design.layers.length > 0);
  const hasHistory = useDesignStore((s) => s.past.length > 0);
  const loadDesign = useDesignStore((s) => s.loadDesign);
  const [dismissedDesignId, setDismissedDesignId] = useState<string | null>(null);
  const showInspiration = !hasLayers && !hasHistory && dismissedDesignId !== designId;

  const [showSignIn, setShowSignIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState<{ token: string; email: string } | null>(null);
  // Set when a password (or a provider round-trip) came back with a
  // second-factor challenge instead of a session.
  const [challenge, setChallenge] = useState<string | null>(null);
  // Unread notifications. There's no bell in the top bar any more — the
  // count surfaces as a dot on the Profile tab/destination itself (see
  // Nav.tsx's DestinationIcon), and the full list is a Profile subview
  // (shell/views/NotificationsView.tsx) rather than a modal.
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener("hashchange", syncFromLocation);
    return () => {
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener("hashchange", syncFromLocation);
    };
  }, []);

  // Coming back from a provider: the token rides in the URL fragment and
  // is claimed (and scrubbed from the address bar) before anything else
  // reads the session. See api/auth.ts's consumeSocialRedirect.
  // A reset link lands as #/reset-password?token=…&email=…, an email
  // confirmation bounces back as #verify=ok|invalid, and a provider
  // sign-in as #token=…. All three are read here.
  //
  // On mount *and* on hashchange: clicking one of those links with the
  // app already open in that tab is a same-document navigation, so a
  // mount-only listener would let the hash change and nothing happen.
  useEffect(() => {
    const handleAuthHash = () => {
      const hash = window.location.hash;
      const scrub = () => window.history.replaceState(null, "", window.location.pathname + window.location.search);

      const reset = /^#\/reset-password\?(.*)$/.exec(hash);
      if (reset) {
        const params = new URLSearchParams(reset[1]);
        const token = params.get("token");
        const email = params.get("email");
        scrub();
        if (token && email) setResetting({ token, email });
        return;
      }

      if (hash.includes("verify=")) {
        const ok = hash.includes("verify=ok");
        scrub();
        setAuthNotice(ok ? "Email address confirmed." : null);
        setAuthError(ok ? null : "That confirmation link has expired or is no longer valid. Sign in and request a new one.");
        return;
      }

      const { challenge: socialChallenge, error } = consumeSocialRedirect();

      // A provider sign-in on an account with 2FA comes back with a
      // challenge rather than a token — same prompt as the password path.
      if (socialChallenge) setChallenge(socialChallenge);

      if (error) {
        setAuthError(
          error === "email_unverified"
            ? "That provider couldn't confirm your email address, and an account here already uses it. Sign in with your password instead."
            : "Sign-in was cancelled or the provider refused. Nothing has changed.",
        );
      }
    };

    handleAuthHash();
    window.addEventListener("hashchange", handleAuthHash);
    return () => window.removeEventListener("hashchange", handleAuthHash);
  }, []);

  useEffect(() => {
    restoreSession();
  }, []);

  // The unread count, fetched once when an account appears (a sign-in, or
  // a restored session). Deliberately not polled: a count that refreshes
  // on its own would need either polling every account into the backend
  // or a socket, and neither is worth it before anyone is waiting on
  // second-by-second news.
  useEffect(() => {
    if (!user) return setUnread(0);

    loadNotifications()
      .then(({ unread: count }) => setUnread(count))
      .catch(() => setUnread(0));
  }, [user]);

  // A suspended account is signed in as far as the API is concerned, but
  // every feature 403s — so the shell says so and offers the appeal
  // instead of leaving a working-looking app that refuses everything.
  const suspended = useSyncExternalStore(subscribe, getSuspended);

  // Same swap AccountButton does in the embed: signing in moves storage
  // from this browser to the account.
  useEffect(() => {
    setActiveDesignStorage(user ? apiDesignStorage : localStorageDesignStorage);
  }, [user]);

  // The account slot, once notifications (a bell), edit-profile (the
  // "Phil" pill) and sign-out all moved out of it: for a signed-in
  // account there's nothing left to put here. Both TopNav and BottomTabs
  // already render a "Profile" destination — that's the way in, same as
  // Design or Library — and the unread count now lives on that
  // destination's own icon (Nav.tsx's DestinationIcon) rather than a
  // second, competing indicator up here. Signed out still needs exactly
  // one affordance, so that's the only thing this ever renders now.
  // Nothing in the account slot while suspended either: they aren't
  // signed out, so "Sign in" would be a lie, and the notice below is the
  // whole story.
  const account = suspended || user ? null : (
    // Icon-only: this sits beside GlobalSearch in the header now (both the
    // desktop TopNav and the mobile header below), and the text label
    // "Sign in" no longer fits alongside it on a phone-width bar.
    <button className="cs-icon-btn" onClick={() => setShowSignIn(true)} data-testid="sign-in" title="Sign in" aria-label="Sign in">
      <LogIn size={19} />
    </button>
  );

  return (
    <div className="cs-root" style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "system-ui, sans-serif" }} data-testid="app-shell">
      {!narrow && <TopNav account={account} unread={unread} />}

      {narrow && (
        // The phone header is just a title and the account — navigation
        // lives at the bottom where a thumb can reach it.
        <header
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px", height: 48, borderBottom: "1px solid var(--cs-border)", flex: "none" }}
          data-testid="mobile-header"
        >
          <img src="/icon-192.png" alt="Card Studio" width={26} height={26} style={{ borderRadius: 6, flex: "none" }} />
          <div style={{ flex: 1 }} />
          <GlobalSearch />
          {account}
        </header>
      )}

      {/* The editor stays mounted across navigation: unmounting the canvas
          would throw away the design in progress, undo history included,
          every time someone glanced at the gallery. The other views are
          cheap and mount on demand. */}
      <main style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div data-testid="page-design" style={{ position: "absolute", inset: 0, visibility: route.tab === "design" ? "visible" : "hidden" }}>
          <App />
          {/* Sits in front of the canvas rather than replacing <App/> in
              the tree — the editor underneath stays mounted exactly like
              every other tab switch (see the comment above `main`), it's
              just covered until there's something to look at. */}
          {showInspiration && (
            <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
              <DesignInspiration
                onStartBlank={() => {
                  const fresh = createEmptyDesign(randomUUID(), STANDARD_CARD_SIZE_MM);
                  loadDesign(fresh);
                  setDismissedDesignId(fresh.id);
                }}
                onUseTemplate={(fromTemplate) => {
                  loadDesign(fromTemplate);
                  setDismissedDesignId(fromTemplate.id);
                }}
                onViewProfile={(username) => navigate({ tab: "profile", username })}
                onBrowseAll={() => navigate({ tab: "templates" })}
              />
            </div>
          )}
        </div>
        {route.tab !== "design" && (
          // Keyed by the nav epoch so re-selecting the current tab
          // remounts the view and refetches — see navStore's `epoch`.
          <div key={epoch} style={{ position: "absolute", inset: 0 }}>
            {route.tab === "library" && <LibraryView />}
            {route.tab === "templates" && <TemplatesView />}
            {route.tab === "guides" && <GuidesView />}
            {route.tab === "profile" && <ProfileView onSignIn={() => setShowSignIn(true)} unread={unread} onUnreadChange={setUnread} />}
            {route.tab === "moderation" && <ModerationView />}
          </div>
        )}
      </main>

      {authNotice && (
        <div
          data-testid="auth-notice"
          style={{
            padding: "10px 16px",
            background: "var(--cs-accent-soft)",
            color: "var(--cs-accent)",
            fontSize: 15,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span style={{ flex: 1 }}>{authNotice}</span>
          <button className="cs-icon-btn" onClick={() => setAuthNotice(null)} title="Dismiss">
            <X size={17} />
          </button>
        </div>
      )}

      {authError && (
        <div
          data-testid="auth-error"
          style={{
            padding: "10px 16px",
            background: "var(--cs-danger-soft)",
            color: "var(--cs-danger)",
            fontSize: 15,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span style={{ flex: 1 }}>{authError}</span>
          <button className="cs-icon-btn" onClick={() => setAuthError(null)} title="Dismiss">
            <X size={17} />
          </button>
        </div>
      )}

      {suspended && <SuspendedNotice />}

      {narrow && <BottomTabs unread={unread} />}

      {showSignIn && (
        <AccountModal
          onSignedIn={() => {
            setShowSignIn(false);
            navigate({ tab: "profile" });
          }}
          onChallenge={(id) => {
            setShowSignIn(false);
            setChallenge(id);
          }}
          onClose={() => setShowSignIn(false)}
        />
      )}

      {challenge && (
        <TwoFactorPrompt
          challenge={challenge}
          onSignedIn={() => {
            setChallenge(null);
            navigate({ tab: "profile" });
          }}
          onCancel={() => setChallenge(null)}
        />
      )}

      {resetting && (
        <ResetPasswordModal
          token={resetting.token}
          email={resetting.email}
          onDone={() => {
            setResetting(null);
            setShowSignIn(true);
          }}
          onClose={() => setResetting(null)}
        />
      )}
    </div>
  );
}
