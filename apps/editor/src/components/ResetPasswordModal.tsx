import { useState } from "react";
import { Loader2 } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { resetPassword } from "../api/auth";
import { Modal } from "./Modal";

/**
 * Opened when the app is loaded from a reset link. A dialog rather than a
 * destination: choosing a new password is a task you finish and dismiss.
 */
export function ResetPasswordModal({ token, email, onDone, onClose }: { token: string; email: string; onDone: () => void; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      setDone(await resetPassword({ token, email, password }));
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't reset your password — the link may have expired. Request a new one."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Choose a new password"
      onClose={onClose}
      width="min(400px, 92vw)"
      onSubmit={() => void submit()}
      footer={
        done ? (
          <button type="button" className="cs-btn cs-active" onClick={onDone} data-testid="reset-done-close">
            Sign in
          </button>
        ) : (
          <button type="submit" className="cs-btn cs-active" disabled={submitting || password.length < 8} data-testid="reset-submit">
            {submitting ? <Loader2 size={14} className="cs-spin" /> : null} Set password
          </button>
        )
      }
    >
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {done ? (
          <p style={{ margin: 0, fontSize: 13 }} data-testid="reset-done">
            {done}
          </p>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 13, color: "var(--cs-text-muted)" }}>Setting a new password for {email}.</p>
            <input
              className="cs-input"
              type="password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              autoFocus
              data-testid="reset-password"
            />
            <span style={{ fontSize: 11, color: "var(--cs-text-muted)" }}>At least 8 characters, with letters and numbers.</span>
            <p style={{ fontSize: 11, color: "var(--cs-text-muted)", margin: 0 }}>
              This signs you out everywhere else — anyone else holding a session on this account loses it.
            </p>
            {error && <p style={{ color: "var(--cs-danger)", fontSize: 13, margin: 0 }}>{error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
