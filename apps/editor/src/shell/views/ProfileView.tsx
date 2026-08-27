import { useSyncExternalStore } from "react";
import { LogIn } from "lucide-react";
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
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--cs-text-muted)" }}>
            Sign in to get a profile — your published templates, collections and designs live there, along with your level and badges.
          </p>
          <button className="cs-btn" onClick={onSignIn} data-testid="profile-sign-in">
            <LogIn size={16} /> Sign in
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
