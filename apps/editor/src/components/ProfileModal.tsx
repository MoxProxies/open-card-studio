import { useState } from "react";
import { Download, Loader2, LogOut, MailWarning, ShieldCheck, Trash2, Upload } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { logoutEverywhere, resendVerification, setCurrentUser, type AuthUser } from "../api/auth";
import { updateProfile } from "../api/profiles";
import { AccountSessions } from "./AccountSessions";
import { DeleteAccountModal } from "./DeleteAccountModal";
import { TwoFactorSetupModal } from "./TwoFactorSetupModal";
import { ReauthModal } from "./ReauthModal";
import { disableTwoFactor, regenerateRecoveryCodes } from "../api/twoFactor";
import { downloadMyData } from "../api/account";
import { uploadImage } from "../api/uploads";
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
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [settingUpTwoFactor, setSettingUpTwoFactor] = useState(false);
  const [twoFactorNotice, setTwoFactorNotice] = useState<string | null>(null);
  // Which protected 2FA change is waiting on a password/code, if any.
  const [reauthFor, setReauthFor] = useState<"disable" | "recovery-codes" | null>(null);
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[] | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // Defaults to on for an account whose record predates the column.
  const [emailDigest, setEmailDigest] = useState(user.notification_emails !== false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProfile({
        name: name.trim(),
        username: username.trim(),
        bio: bio.trim(),
        avatar_url: avatarUrl.trim() || null,
        notification_emails: emailDigest,
      });
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
          Avatar
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                width={40}
                height={40}
                style={{ borderRadius: "50%", objectFit: "cover", flex: "none", background: "var(--cs-surface-soft)" }}
                data-testid="avatar-preview"
              />
            )}
            <input className="cs-input" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" data-testid="profile-avatar" />
            {/* Uploading fills the same field an https link goes in, so
                there's still one source of truth for what the avatar is
                — the upload just happens to produce the URL for you. */}
            <label className="cs-btn" style={{ cursor: "pointer", flex: "none" }} data-testid="avatar-upload">
              {avatarBusy ? <Loader2 size={14} className="cs-spin" /> : <Upload size={14} />}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setAvatarBusy(true);
                  setError(null);
                  void uploadImage(file, "avatar")
                    .then((image) => setAvatarUrl(image.url))
                    .catch((problem: Error) => setError(problem.message))
                    .finally(() => setAvatarBusy(false));
                }}
              />
            </label>
          </div>
          <span style={{ fontSize: 11 }}>Upload an image, or paste an https link to one. Uploads are resized and stripped of camera metadata.</span>
        </label>

        <hr style={{ border: "none", borderTop: "1px solid var(--cs-border)", margin: "4px 0" }} />

        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "var(--cs-text-muted)" }}>
          <input
            type="checkbox"
            checked={emailDigest}
            onChange={(e) => setEmailDigest(e.target.checked)}
            data-testid="profile-email-digest"
            style={{ marginTop: 2 }}
          />
          <span>
            Email me when something happens to my work — one summary a day at most, never for things I've already seen in the app. Every one of those emails can
            turn this off in a click.
          </span>
        </label>

        <hr style={{ border: "none", borderTop: "1px solid var(--cs-border)", margin: "4px 0" }} />

        {/* The second factor. Off is one button; on is a state worth
            stating plainly, because someone who can't remember whether
            they enabled it will assume they didn't. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--cs-text-muted)" }}>Two-factor authentication</span>
          {user.has_two_factor ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="two-factor-on">
              <ShieldCheck size={16} style={{ color: "var(--cs-accent)" }} />
              <span style={{ flex: 1, fontSize: 12 }}>On — a code from your app is needed to sign in.</span>
              <button type="button" className="cs-btn" data-testid="two-factor-codes" onClick={() => setReauthFor("recovery-codes")}>
                New recovery codes
              </button>
              <button type="button" className="cs-btn" data-testid="two-factor-disable" onClick={() => setReauthFor("disable")}>
                Turn off
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 12 }}>Off. A stolen password is enough to get in.</span>
              <button type="button" className="cs-btn" data-testid="two-factor-enable" onClick={() => setSettingUpTwoFactor(true)}>
                <ShieldCheck size={14} /> Turn on
              </button>
            </div>
          )}
          {twoFactorNotice && (
            <span style={{ fontSize: 11 }} data-testid="two-factor-notice">
              {twoFactorNotice}
            </span>
          )}
        </div>

        {settingUpTwoFactor && <TwoFactorSetupModal user={user} onClose={() => setSettingUpTwoFactor(false)} />}

        {reauthFor && (
          <ReauthModal
            user={user}
            title={reauthFor === "disable" ? "Turn off two-factor" : "New recovery codes"}
            description={
              reauthFor === "disable"
                ? "Your password alone will be enough to sign in again."
                : "The codes you have now stop working, and the new set is shown once."
            }
            confirmLabel={reauthFor === "disable" ? "Turn it off" : "Generate"}
            onConfirm={async (confirmation) => {
              if (reauthFor === "disable") {
                await disableTwoFactor(confirmation);
                setCurrentUser({ ...user, has_two_factor: false });
                setTwoFactorNotice("Two-factor authentication is off.");
                return;
              }
              const { recovery_codes } = await regenerateRecoveryCodes(confirmation);
              setNewRecoveryCodes(recovery_codes);
            }}
            onClose={() => setReauthFor(null)}
          />
        )}

        {newRecoveryCodes && (
          <Modal
            title="Save your recovery codes"
            onClose={() => setNewRecoveryCodes(null)}
            width="min(420px, 92vw)"
            testId="recovery-codes"
            stacked
            footer={
              <button type="button" className="cs-btn cs-active" onClick={() => setNewRecoveryCodes(null)} data-testid="recovery-codes-done">
                I've saved them
              </button>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, fontSize: 13 }}>
              <p style={{ margin: 0 }}>
                Your old codes no longer work. Each of these works once, and <strong>this is the only time they're shown.</strong>
              </p>
              <pre
                style={{ margin: 0, padding: 12, borderRadius: 8, background: "var(--cs-surface-soft)", fontSize: 13, lineHeight: 1.7, userSelect: "all" }}
                data-testid="recovery-code-list"
              >
                {newRecoveryCodes.join("\n")}
              </pre>
            </div>
          </Modal>
        )}

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

        <hr style={{ border: "none", borderTop: "1px solid var(--cs-border)", margin: "4px 0" }} />

        {/* Your data, and the door out. Both are things a Terms of
            Service will need to point at — see the vision doc's
            constraints section. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--cs-text-muted)" }}>Your data</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className="cs-btn"
              data-testid="export-data"
              onClick={() =>
                void downloadMyData()
                  .then((filename) => setExportNotice(`Saved ${filename}.`))
                  .catch(() => setExportNotice("Couldn't build the export — try again shortly."))
              }
            >
              <Download size={14} /> Download my data
            </button>
            <button type="button" className="cs-btn cs-danger" data-testid="delete-account-open" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={14} /> Delete account
            </button>
          </div>
          {exportNotice && (
            <span style={{ fontSize: 11 }} data-testid="export-notice">
              {exportNotice}
            </span>
          )}
        </div>

        {confirmingDelete && <DeleteAccountModal user={user} onClose={() => setConfirmingDelete(false)} />}

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
