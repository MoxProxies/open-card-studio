import { useSyncExternalStore } from "react";
import { LogIn, Sparkles } from "lucide-react";
import { useDesignStore } from "../../store/DesignProvider";
import { ProfilePanel } from "../../components/ProfilePanel";
import { getCurrentUser, subscribe } from "../../api/auth";
import { navigate, useRoute } from "../navStore";
import { Page } from "../Page";
import { EditProfileView } from "./EditProfileView";
import { NotificationsView } from "./NotificationsView";
import { SettingsView } from "./SettingsView";

/**
 * Someone's public profile — the signed-in account's own when the route
 * carries no username. Signed out and with no username, there's nothing
 * to show, so it offers the sign-in instead of erroring.
 *
 * Edit-profile, notifications and settings all live here too, as
 * subviews keyed by `route.view` (see navStore.ts) rather than modals:
 * `unread`/`onUnreadChange` are threaded down from AppShell, which is
 * also the only other place the count is read (the Profile tab's own
 * badge — there's no bell in the top bar any more).
 */
export function ProfileView({ onSignIn, unread, onUnreadChange }: { onSignIn: () => void; unread: number; onUnreadChange: (unread: number) => void }) {
  const route = useRoute();
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const loadDesign = useDesignStore((s) => s.loadDesign);
  const username = route.username ?? user?.username;

  if (!username) {
    return (
      <Page testId="page-profile" title="Profile">
        <div
          style={{
            position: "relative",
            height: "100%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
            padding: "32px 24px",
            textAlign: "center",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              width: 260,
              height: 260,
              borderRadius: "50%",
              background: "radial-gradient(circle, var(--cs-accent-soft), transparent 72%)",
              filter: "blur(6px)",
              transform: "translateY(-56px)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "relative",
              width: 112,
              height: 112,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "radial-gradient(circle at 32% 28%, var(--cs-accent-soft), var(--cs-surface-soft) 70%)",
              boxShadow: "0 0 0 1px var(--cs-border), 0 24px 48px -20px var(--cs-shadow)",
            }}
          >
            <Sparkles size={44} color="var(--cs-accent)" strokeWidth={1.5} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 320 }}>
            <h2 className="cs-heading" style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
              Your profile is waiting
            </h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "var(--cs-text-muted)" }}>
              Sign in to publish templates and collections, and track your level and badges.
            </p>
          </div>

          <button
            className="cs-btn"
            onClick={onSignIn}
            data-testid="profile-sign-in"
            style={{
              marginTop: 4,
              padding: "12px 28px",
              borderRadius: 999,
              border: "1px solid var(--cs-accent)",
              background: "var(--cs-accent)",
              color: "var(--cs-surface)",
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            <LogIn size={20} /> Sign in
          </button>
        </div>
      </Page>
    );
  }

  // Edit-profile, notifications, and settings only exist for your own
  // profile (reached with no username in the route — see navStore.ts's
  // ProfileSubview comment), which `username` above already resolved to
  // `user.username` in that case.
  if (user && route.view === "edit") return <EditProfileView user={user} />;
  if (user && route.view === "notifications") return <NotificationsView onUnreadChange={onUnreadChange} />;
  if (user && route.view === "settings") return <SettingsView user={user} />;

  return (
    <ProfilePanel
      key={username}
      username={username}
      onUseTemplate={(fromTemplate) => {
        loadDesign(fromTemplate);
        navigate({ tab: "design" });
      }}
      onEditProfile={() => navigate({ tab: "profile", view: "edit" })}
      onOpenNotifications={() => navigate({ tab: "profile", view: "notifications" })}
      onOpenSettings={() => navigate({ tab: "profile", view: "settings" })}
      unreadCount={unread}
    >
      {({ title, body }) => (
        <Page testId="page-profile" title={title}>
          {body}
        </Page>
      )}
    </ProfilePanel>
  );
}
