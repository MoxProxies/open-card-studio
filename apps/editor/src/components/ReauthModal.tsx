import { useState } from "react";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import type { AuthUser } from "../api/auth";
import { Modal } from "./Modal";

/**
 * "Prove it's you" before a change worth protecting — turning the second
 * factor off, printing new recovery codes.
 *
 * A real dialog rather than window.prompt: a prompt shows the password in
 * clear text as it's typed, can't be styled or explained, and is the kind
 * of thing a password manager won't fill.
 *
 * An account with no password (signed up through a provider) confirms
 * with a current code instead — the same substitution AccountController
 * makes for account deletion.
 */
export function ReauthModal({
  user,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  user: AuthUser;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (confirmation: { password?: string; code?: string }) => Promise<unknown>;
  onClose: () => void;
}) {
  const byPassword = user.has_password !== false;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(byPassword ? { password: value } : { code: value.trim() });
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, "That didn't work — check what you entered."));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      width="min(380px, 92vw)"
      testId="reauth"
      stacked
      footer={
        <>
          <button type="button" className="cs-btn" onClick={onClose}>
            Cancel
          </button>
          {/* Not a submit button: this opens from inside ProfileModal,
              which is itself a <form>, and nested forms are invalid HTML
              the browser drops. */}
          <button type="button" className="cs-btn cs-active" data-testid="reauth-confirm" disabled={busy || value.length === 0} onClick={() => void submit()}>
            {busy ? <Loader2 size={14} className="cs-spin" /> : null} {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, fontSize: 13 }}>
        <p style={{ margin: 0 }}>{description}</p>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--cs-text-muted)" }}>
          {byPassword ? "Your password" : "A code from your authenticator app"}
          <input
            className="cs-input"
            type={byPassword ? "password" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.length > 0) void submit();
            }}
            data-testid="reauth-value"
            autoFocus
          />
        </label>
        {error && <p style={{ color: "var(--cs-danger)", margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}
