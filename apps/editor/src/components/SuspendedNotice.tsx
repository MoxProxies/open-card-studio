import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { loadAppeal, logout, submitAppeal, type Appeal } from "../api/auth";
import { Modal } from "./Modal";

const MIN_LENGTH = 20;

/**
 * What a suspended account sees instead of the app.
 *
 * The point is that it isn't a dead end: it says the account is
 * suspended, and it offers the one thing that account can still do —
 * write an appeal a human will read. A suspension with no route to
 * contest it is the gap docs/PRODUCT_VISION.md left open at the end of
 * Phase 6.
 */
export function SuspendedNotice() {
  const [appeal, setAppeal] = useState<Appeal | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAppeal()
      .then((state) => setAppeal(state.appeal))
      .catch(() => setAppeal(null));
  }, []);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      setAppeal(await submitAppeal(message.trim()));
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't send that — try again shortly."));
    } finally {
      setSending(false);
    }
  };

  // An open appeal, or a decided one: either way there's nothing to write,
  // so the form gives way to what happened.
  const pending = appeal?.state === "open";
  const decided = appeal && appeal.state !== "open";

  return (
    <Modal
      title="Account suspended"
      // No close button: dismissing this would leave an app where every
      // action fails with no explanation on screen.
      onClose={() => {}}
      dismissable={false}
      width="min(520px, 92vw)"
      testId="suspended-notice"
      footer={
        <>
          <button type="button" className="cs-btn" data-testid="suspended-sign-out" onClick={() => void logout()}>
            Sign out
          </button>
          {!pending && !decided && (
            <button
              type="button"
              className="cs-btn cs-active"
              data-testid="appeal-submit"
              disabled={sending || message.trim().length < MIN_LENGTH}
              onClick={() => void send()}
            >
              {sending ? <Loader2 size={14} className="cs-spin" /> : null} Send appeal
            </button>
          )}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, fontSize: 13 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <ShieldAlert size={20} style={{ flex: "none", color: "var(--cs-danger)" }} />
          <p style={{ margin: 0 }}>
            This account is suspended, so its designs, templates and profile aren't publicly visible and it can't publish anything. Your work isn't deleted.
          </p>
        </div>

        {appeal === undefined && <p style={{ margin: 0, color: "var(--cs-text-muted)" }}>Checking whether you've already appealed…</p>}

        {pending && (
          <p style={{ margin: 0 }} data-testid="appeal-pending">
            Your appeal is with us — sent {new Date(appeal.submitted_at).toLocaleDateString()}. You'll see the answer here.
          </p>
        )}

        {decided && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="appeal-decided">
            <strong>{appeal.state === "granted" ? "Your appeal was granted." : "Your appeal was declined."}</strong>
            <p style={{ margin: 0, color: "var(--cs-text-muted)" }}>{appeal.response}</p>
            {appeal.state === "granted" && <p style={{ margin: 0 }}>Sign out and back in to pick up where you left off.</p>}
          </div>
        )}

        {appeal === null && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--cs-text-muted)" }}>
            If you think this is a mistake, tell us why. A person reads these.
            <textarea
              className="cs-input"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened, and anything that supports your side of it."
              data-testid="appeal-message"
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
            <span>{message.trim().length < MIN_LENGTH ? `At least ${MIN_LENGTH} characters.` : " "}</span>
          </label>
        )}

        {error && <p style={{ color: "var(--cs-danger)", margin: 0 }}>{error}</p>}
      </div>
    </Modal>
  );
}
