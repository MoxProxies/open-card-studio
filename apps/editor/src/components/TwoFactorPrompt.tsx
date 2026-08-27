import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { completeTwoFactor } from "../api/auth";
import { Modal } from "./Modal";

/**
 * The code half of a sign-in. Reached two ways — a password login that
 * came back with a challenge, and a provider redirect carrying
 * `#challenge=` — so it lives on its own rather than inside the sign-in
 * dialog.
 */
export function TwoFactorPrompt({ challenge, onSignedIn, onCancel }: { challenge: string; onSignedIn: () => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeTwoFactor(challenge, code);
      onSignedIn();
    } catch (e) {
      setError(apiErrorMessage(e, "That didn't work — try the next code your app shows."));
      setCode("");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Enter your code"
      onClose={onCancel}
      width="min(360px, 92vw)"
      testId="two-factor-prompt"
      onSubmit={() => void submit()}
      footer={
        <button type="submit" className="cs-btn cs-active" data-testid="two-factor-submit" disabled={busy || code.trim().length < 6}>
          {busy ? <Loader2 size={14} className="cs-spin" /> : null} Sign in
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, fontSize: 13 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <ShieldCheck size={20} style={{ flex: "none", color: "var(--cs-accent)" }} />
          <p style={{ margin: 0 }}>Your password was right. Enter the six-digit code from your authenticator app to finish signing in.</p>
        </div>

        <input
          className="cs-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          // A numeric keypad on a phone, but not type="number": recovery
          // codes go in this same field and they aren't numbers.
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          data-testid="two-factor-code"
          style={{ fontSize: 18, letterSpacing: 2, textAlign: "center" }}
        />

        <span style={{ fontSize: 11, color: "var(--cs-text-muted)" }}>Lost your phone? Use one of your recovery codes here instead.</span>

        {error && <p style={{ color: "var(--cs-danger)", margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}
