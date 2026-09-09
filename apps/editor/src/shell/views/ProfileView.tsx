import { useSyncExternalStore } from "react";
import { LogIn, Sparkles } from "lucide-react";
import { useDesignStore } from "../../store/DesignProvider";
import { ProfilePanel } from "../../components/ProfilePanel";
import { getCurrentUser, subscribe } from "../../api/auth";
import { navigate, useRoute } from "../navStore";
import { Page } from "../Page";

/**
 * Someone's public profile — the signed-in account's own when the route
 * carries no username. Signed out and with no username, there's nothing
 * to show, so it offers the sign-in instead of erroring.
 */
export function ProfileView({ onSignIn }: { onSignIn: () => void }) {
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

  return (
    <ProfilePanel
      key={username}
      username={username}
      onUseTemplate={(fromTemplate) => {
        loadDesign(fromTemplate);
        navigate({ tab: "design" });
      }}
    >
      {({ title, body }) => (
        <Page testId="page-profile" title={title}>
          {body}
        </Page>
      )}
    </ProfilePanel>
  );
}
