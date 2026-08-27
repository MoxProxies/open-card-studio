import { useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { deleteAccount } from "../api/account";
import type { AuthUser } from "../api/auth";
import { Modal } from "./Modal";

/**
 * Closing an account, with the one confirmation that matters: proving
 * intent. A password account re-enters its password; a social-only one
 * has none, so it types its username instead. Either way this is a
 * deliberate act, not a button an unattended browser can be walked into.
 */
export function DeleteAccountModal({ user, onClose }: { user: AuthUser; onClose: () => void }) {
  // has_password comes from /api/auth/me; treat an older payload without
  // it as a password account, which asks for the stricter confirmation.
  const byPassword = user.has_password !== false;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(byPassword ? { password: value } : { confirm_username: value });
      // logout() already cleared the session, so there's nothing left for
      // this dialog to be attached to.
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't delete the account — try again shortly."));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Delete your account"
      onClose={onClose}
      width="min(460px, 92vw)"
      testId="delete-account"
      stacked
      footer={
        <>
          <button type="button" className="cs-btn" onClick={onClose}>
            Keep my account
          </button>
          {/* A plain button, not a submit: this dialog opens from inside
              ProfileModal, which is itself a <form>, and a nested form is
              invalid HTML the browser silently drops — leaving the button
              submitting the profile editor underneath. */}
          <button
            type="button"
            className="cs-btn cs-danger"
            data-testid="delete-account-confirm"
            disabled={busy || value.length === 0}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 size={14} className="cs-spin" /> : null} Delete everything
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, fontSize: 13 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <TriangleAlert size={20} style={{ flex: "none", color: "var(--cs-danger)" }} />
          <p style={{ margin: 0 }}>
            This deletes your designs, templates, collections, guides, comments and points. It can't be undone, and published templates disappear for everyone —
            though designs already made from them keep working, since those copied the layers.
          </p>
        </div>

        <p style={{ margin: 0, color: "var(--cs-text-muted)" }}>Take a copy first if you want one: “Download my data” is on the previous screen.</p>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--cs-text-muted)" }}>
          {byPassword ? "Enter your password to confirm" : `Type “${user.username}” to confirm`}
          <input
            className="cs-input"
            type={byPassword ? "password" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.length > 0) void submit();
            }}
            data-testid="delete-account-confirmation"
            autoFocus
          />
        </label>

        {error && <p style={{ color: "var(--cs-danger)", margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}
