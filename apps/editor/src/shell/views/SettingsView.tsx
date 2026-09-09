import { useState } from "react";
import { ArrowLeft, Download, LogOut, MailWarning, ShieldCheck, Trash2 } from "lucide-react";
import { apiErrorMessage } from "../../api/client";
import { logout, logoutEverywhere, resendVerification, setCurrentUser, type AuthUser } from "../../api/auth";
import { updateProfile } from "../../api/profiles";
import { downloadMyData } from "../../api/account";
import { disableTwoFactor, regenerateRecoveryCodes } from "../../api/twoFactor";
import { AccountSessions } from "../../components/AccountSessions";
import { DeleteAccountModal } from "../../components/DeleteAccountModal";
import { TwoFactorSetupModal } from "../../components/TwoFactorSetupModal";
import { ReauthModal } from "../../components/ReauthModal";
import { Modal } from "../../components/Modal";
import { navigate } from "../navStore";
import { Page } from "../Page";

/**
 * Account-level settings — everything from the old ProfileModal that
 * isn't a presentation field (those are EditProfileView now): email
 * verification, the notification-email preference, two-factor, signed-in
 * devices, your data, and the door out. Sign out lives at the bottom,
 * where account.moderation_state or delete-account already set the
 * precedent for "the destructive/final stuff sits at the end of the
 * settings page" pattern most apps use.
 *
 * The 2FA setup flow and the delete-account confirmation stay modals —
 * both are the kind of thing AppShell.tsx's own doc comment carves out as
 * "genuinely one": a QR-scan-then-confirm ceremony and an irreversible
 * confirmation, not a destination you'd ever navigate back to mid-flow.
 */
export function SettingsView({ user }: { user: AuthUser }) {
  const [error, setError] = useState<string | null>(null);
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [settingUpTwoFactor, setSettingUpTwoFactor] = useState(false);
  const [twoFactorNotice, setTwoFactorNotice] = useState<string | null>(null);
  // Which protected 2FA change is waiting on a password/code, if any.
  const [reauthFor, setReauthFor] = useState<"disable" | "recovery-codes" | null>(null);
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[] | null>(null);
  // Defaults to on for an account whose record predates the column.
  const [emailDigest, setEmailDigest] = useState(user.notification_emails !== false);
  const [savingDigest, setSavingDigest] = useState(false);

  const back = () => navigate({ tab: "profile" });

  const toggleEmailDigest = async (checked: boolean) => {
    setEmailDigest(checked);
    setSavingDigest(true);
    setError(null);
    try {
      const updated = await updateProfile({ notification_emails: checked });
      setCurrentUser(updated);
    } catch (e) {
      setEmailDigest(!checked);
      setError(apiErrorMessage(e, "Couldn't save that. Check your connection and try again."));
    } finally {
      setSavingDigest(false);
    }
  };

  return (
    <Page testId="page-profile-settings" title="Settings">
      <div style={{ padding: "0 8px", display: "flex", flexDirection: "column", gap: 14 }}>
        <button className="cs-btn" onClick={back} style={{ alignSelf: "flex-start" }} data-testid="settings-back">
          <ArrowLeft size={17} /> Profile
        </button>

        {/* Social accounts arrive verified — the provider already proved
            the address — so this only appears for password signups. */}
        {!user.email_verified_at && (
          <div
            data-testid="unverified-email"
            style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "var(--cs-accent-soft)", fontSize: 14 }}
          >
            <MailWarning size={19} style={{ flex: "none" }} />
            <span style={{ flex: 1 }}>{verifyNotice ?? `${user.email} isn't confirmed yet.`}</span>
            {!verifyNotice && (
              <button
                type="button"
                className="cs-btn"
                data-testid="resend-verification"
                onClick={() =>
                  void resendVerification()
                    .then(setVerifyNotice)
                    .catch(() => setVerifyNotice("Couldn't send that. Try again shortly."))
                }
              >
                Resend
              </button>
            )}
          </div>
        )}

        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, color: "var(--cs-text-muted)" }}>
          <input
            type="checkbox"
            checked={emailDigest}
            disabled={savingDigest}
            onChange={(e) => void toggleEmailDigest(e.target.checked)}
            data-testid="profile-email-digest"
            style={{ marginTop: 2 }}
          />
          <span>
            Email me when something happens to my work: one summary a day at most, never for things I've already seen in the app. Every one of those emails can
            turn this off in a click.
          </span>
        </label>

        <hr style={{ border: "none", borderTop: "1px solid var(--cs-border)", margin: "4px 0" }} />

        {/* The second factor. Off is one button; on is a state worth
            stating plainly, because someone who can't remember whether
            they enabled it will assume they didn't. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 14, color: "var(--cs-text-muted)" }}>Two-factor authentication</span>
          {user.has_two_factor ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="two-factor-on">
              <ShieldCheck size={19} style={{ color: "var(--cs-accent)" }} />
              <span style={{ flex: 1, fontSize: 14 }}>On: a code from your app is needed to sign in.</span>
              <button type="button" className="cs-btn" data-testid="two-factor-codes" onClick={() => setReauthFor("recovery-codes")}>
                New recovery codes
              </button>
              <button type="button" className="cs-btn" data-testid="two-factor-disable" onClick={() => setReauthFor("disable")}>
                Turn off
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 14 }}>Off. A stolen password is enough to get in.</span>
              <button type="button" className="cs-btn" data-testid="two-factor-enable" onClick={() => setSettingUpTwoFactor(true)}>
                <ShieldCheck size={17} /> Turn on
              </button>
            </div>
          )}
          {twoFactorNotice && (
            <span style={{ fontSize: 13 }} data-testid="two-factor-notice">
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
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, fontSize: 15 }}>
              <p style={{ margin: 0 }}>
                Your old codes no longer work. Each of these works once, and <strong>this is the only time they're shown.</strong>
              </p>
              <pre
                style={{ margin: 0, padding: 12, borderRadius: 8, background: "var(--cs-surface-soft)", fontSize: 15, lineHeight: 1.7, userSelect: "all" }}
                data-testid="recovery-code-list"
              >
                {newRecoveryCodes.join("\n")}
              </pre>
            </div>
          </Modal>
        )}

        <hr style={{ border: "none", borderTop: "1px solid var(--cs-border)", margin: "4px 0" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 14, color: "var(--cs-text-muted)" }}>Signed-in devices</span>
          <AccountSessions onSignedOut={back} />
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
              void logoutEverywhere().then(back);
            }}
          >
            <LogOut size={17} /> Sign out everywhere
          </button>
          <span style={{ fontSize: 13 }}>Ends every signed-in session on every device.</span>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--cs-border)", margin: "4px 0" }} />

        {/* Your data, and the door out. Both are things a Terms of
            Service will need to point at — see the vision doc's
            constraints section. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 14, color: "var(--cs-text-muted)" }}>Your data</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className="cs-btn"
              data-testid="export-data"
              onClick={() =>
                void downloadMyData()
                  .then((filename) => setExportNotice(`Saved ${filename}.`))
                  .catch(() => setExportNotice("Couldn't build the export. Try again shortly."))
              }
            >
              <Download size={17} /> Download my data
            </button>
            <button type="button" className="cs-btn cs-danger" data-testid="delete-account-open" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={17} /> Delete account
            </button>
          </div>
          {exportNotice && (
            <span style={{ fontSize: 13 }} data-testid="export-notice">
              {exportNotice}
            </span>
          )}
        </div>

        {confirmingDelete && <DeleteAccountModal user={user} onClose={() => setConfirmingDelete(false)} />}

        {error && <p style={{ color: "var(--cs-danger)", fontSize: 15, margin: 0 }}>{error}</p>}

        <hr style={{ border: "none", borderTop: "1px solid var(--cs-border)", margin: "4px 0" }} />

        <button
          type="button"
          className="cs-btn"
          style={{ alignSelf: "flex-start" }}
          data-testid="sign-out"
          onClick={() => {
            if (!window.confirm("Sign out? You'll go back to designs saved only in this browser.")) return;
            navigate({ tab: "profile" }, { replace: true });
            void logout();
          }}
        >
          <LogOut size={17} /> Sign out
        </button>
      </div>
    </Page>
  );
}
