import { useState } from "react";
import { Loader2, LogOut, MailWarning } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { logoutEverywhere, resendVerification, setCurrentUser, type AuthUser } from "../api/auth";
import { updateProfile } from "../api/profiles";
import { AccountSessions } from "./AccountSessions";
import { Modal } from "./Modal";

interface ProfileModalProps {
  user: AuthUser;
  onClose: () => void;
  /** Opens this account's own public profile, so an author can see what
   * everyone else sees without leaving the editor. */
  onViewPublic: (username: string) => void;
}

/** Edit your own profile — display name, public handle, bio, avatar URL.
 * The handle is what a profile is addressed by, so it gets the explaining
 * text; `name` stays free-text and non-unique. */
export function ProfileModal({ user, onClose, onViewPublic }: ProfileModalProps) {
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProfile({ name: name.trim(), username: username.trim(), bio: bio.trim(), avatar_url: avatarUrl.trim() || null });
      setCurrentUser(updated);
      setSaved(true);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't save your profile — check your connection and try again."));
    } finally {
      setSaving(false);
    }
  };

  const field = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--cs-text-muted)" };

  return (
    <Modal
      title="Your profile"
      onClose={onClose}
      width="min(440px, 92vw)"
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="cs-btn" onClick={() => onViewPublic(user.username)} disabled={!user.username}>
            View public profile
          </button>
          <button type="submit" className="cs-btn cs-active" disabled={saving} data-testid="profile-save">
            {saving ? <Loader2 size={14} className="cs-spin" /> : null} Save
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
        {/* Social accounts arrive verified — the provider already proved
            the address — so this only appears for password signups. */}
        {!user.email_verified_at && (
          <div
            data-testid="unverified-email"
            style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "var(--cs-accent-soft)", fontSize: 12 }}
          >
            <MailWarning size={16} style={{ flex: "none" }} />
            <span style={{ flex: 1 }}>{verifyNotice ?? `${user.email} isn't confirmed yet.`}</span>
            {!verifyNotice && (
              <button
                type="button"
                className="cs-btn"
                data-testid="resend-verification"
                onClick={() =>
                  void resendVerification()
                    .then(setVerifyNotice)
                    .catch(() => setVerifyNotice("Couldn't send that — try again shortly."))
                }
              >
                Resend
              </button>
            )}
          </div>
        )}

        <label style={field}>
          Display name
          <input className="cs-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="profile-name" />
        </label>

        <label style={field}>
          Username
          <input
            className="cs-input"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="your-handle"
            data-testid="profile-username"
          />
          <span style={{ fontSize: 11 }}>Lowercase letters, numbers, dashes and underscores. This is how people find your profile.</span>
        </label>

        <label style={field}>
          Bio
          <textarea
            className="cs-input"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            placeholder="What kind of cards do you make?"
            data-testid="profile-bio"
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
        </label>

        <label style={field}>
          Avatar URL
          <input className="cs-input" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" data-testid="profile-avatar" />
          <span style={{ fontSize: 11 }}>An https link to an image — there's no upload yet.</span>
        </label>

        <hr style={{ border: "none", borderTop: "1px solid var(--cs-border)", margin: "4px 0" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--cs-text-muted)" }}>Signed-in devices</span>
          <AccountSessions onSignedOut={onClose} />
        </div>

        {/* The blunt version of the list above — for when you'd rather not
            work out which row is the problem. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button
            type="button"
            className="cs-btn"
            style={{ alignSelf: "flex-start" }}
            data-testid="sign-out-everywhere"
            onClick={() => {
              if (!window.confirm("Sign out of every device? You'll need to sign in again everywhere, including here.")) return;
              void logoutEverywhere().then(onClose);
            }}
          >
            <LogOut size={14} /> Sign out everywhere
          </button>
          <span style={{ fontSize: 11 }}>Ends every signed-in session on every device.</span>
        </div>

        {error && <p style={{ color: "var(--cs-danger)", fontSize: 13, margin: 0 }}>{error}</p>}
        {saved && !error && (
          <p style={{ color: "var(--cs-text-muted)", fontSize: 13, margin: 0 }} data-testid="profile-saved">
            Saved.
          </p>
        )}
      </div>
    </Modal>
  );
}
