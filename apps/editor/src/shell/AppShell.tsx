import { useEffect, useState, useSyncExternalStore } from "react";
import { LogIn, LogOut, User } from "lucide-react";
import { App } from "../App";
import { AccountModal } from "../components/AccountModal";
import { ProfileModal } from "../components/ProfileModal";
import { consumeSocialRedirect, getCurrentUser, logout, restoreSession, subscribe } from "../api/auth";
import { apiDesignStorage } from "../api/apiDesignStorage";
import { localStorageDesignStorage, setActiveDesignStorage } from "../designStorage";
import { useIsNarrow } from "../hooks/useIsNarrow";
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
  const [showSignIn, setShowSignIn] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

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
  useEffect(() => {
    const { error } = consumeSocialRedirect();
    if (error) {
      setAuthError(
        error === "email_unverified"
          ? "That provider couldn't confirm your email address, and an account here already uses it. Sign in with your password instead."
          : "Sign-in was cancelled or the provider refused. Nothing has changed."
      );
    }
    restoreSession();
  }, []);

  // Same swap AccountButton does in the embed: signing in moves storage
  // from this browser to the account.
  useEffect(() => {
    setActiveDesignStorage(user ? apiDesignStorage : localStorageDesignStorage);
  }, [user]);

  const account = user ? (
    <div style={{ display: "flex", gap: 4 }}>
      <button className="cs-btn" onClick={() => setShowProfileEditor(true)} data-testid="account-button" title={`Signed in as ${user.email}`}>
        <User size={16} /> {user.name}
      </button>
      <button
        className="cs-icon-btn"
        data-testid="sign-out"
        title="Sign out"
        onClick={() => {
          if (window.confirm("Sign out? You'll go back to designs saved only in this browser.")) void logout();
        }}
      >
        <LogOut size={14} />
      </button>
    </div>
  ) : (
    <button className="cs-btn" onClick={() => setShowSignIn(true)} data-testid="sign-in">
      <LogIn size={16} /> Sign in
    </button>
  );

  return (
    <div className="cs-root" style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "system-ui, sans-serif" }} data-testid="app-shell">
      {!narrow && <TopNav account={account} />}

      {narrow && (
        // The phone header is just a title and the account — navigation
        // lives at the bottom where a thumb can reach it.
        <header
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 48, borderBottom: "1px solid var(--cs-border)", flex: "none" }}
          data-testid="mobile-header"
        >
          <span className="cs-heading" style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>
            Card Studio
          </span>
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
        </div>
        {route.tab !== "design" && (
          // Keyed by the nav epoch so re-selecting the current tab
          // remounts the view and refetches — see navStore's `epoch`.
          <div key={epoch} style={{ position: "absolute", inset: 0 }}>
            {route.tab === "library" && <LibraryView />}
            {route.tab === "templates" && <TemplatesView />}
            {route.tab === "guides" && <GuidesView />}
            {route.tab === "profile" && <ProfileView onSignIn={() => setShowSignIn(true)} />}
            {route.tab === "moderation" && <ModerationView />}
          </div>
        )}
      </main>

      {authError && (
        <div
          data-testid="auth-error"
          style={{ padding: "10px 16px", background: "var(--cs-danger-soft)", color: "var(--cs-danger)", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}
        >
          <span style={{ flex: 1 }}>{authError}</span>
          <button className="cs-icon-btn" onClick={() => setAuthError(null)} title="Dismiss">
            ×
          </button>
        </div>
      )}

      {narrow && <BottomTabs />}

      {showSignIn && (
        <AccountModal
          onSignedIn={() => {
            setShowSignIn(false);
            navigate({ tab: "profile" });
          }}
          onClose={() => setShowSignIn(false)}
        />
      )}

      {showProfileEditor && user && (
        <ProfileModal
          user={user}
          onClose={() => setShowProfileEditor(false)}
          onViewPublic={(username) => {
            setShowProfileEditor(false);
            navigate({ tab: "profile", username });
          }}
        />
      )}
    </div>
  );
}
