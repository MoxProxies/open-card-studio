import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { login, loadSocialProviders, register, requestPasswordReset, startSocialSignIn, type SocialProvider } from "../api/auth";
import { apiErrorMessage } from "../api/client";
import { Modal } from "./Modal";

interface AccountModalProps {
  onSignedIn: () => void;
  onClose: () => void;
}

type Mode = "login" | "register";

/** Sign in / create account against backend/'s Sanctum token auth (see
 * root README's "Backend (API)"). On success, AccountButton.tsx's caller
 * is responsible for switching designStorage over to apiDesignStorage —
 * this component only handles the credential exchange itself. */
export function AccountModal({ onSignedIn, onClose }: AccountModalProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<SocialProvider[]>([]);
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  // A deployment with no OAuth credentials configured gets no buttons —
  // see the backend's SocialProviders::enabled.
  useEffect(() => {
    loadSocialProviders().then(setProviders);
  }, []);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
      onSignedIn();
    } catch (e) {
      setError(apiErrorMessage(e, "Something went wrong — check your connection and try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={mode === "login" ? "Sign in" : "Create account"} onClose={onClose} width="min(360px, 92vw)" onSubmit={() => void submit()}>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {providers.length > 0 && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="social-providers">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="cs-btn"
                  style={{ justifyContent: "center" }}
                  data-testid={`social-${p.id}`}
                  onClick={() => {
                    setError(null);
                    startSocialSignIn(p.id).catch(() => setError(`Couldn't start sign-in with ${p.label}. Try again in a moment.`));
                  }}
                >
                  Continue with {p.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--cs-text-muted)", fontSize: 11 }}>
              <span style={{ flex: 1, height: 1, background: "var(--cs-border)" }} />
              or
              <span style={{ flex: 1, height: 1, background: "var(--cs-border)" }} />
            </div>
          </>
        )}

        {mode === "register" && <input className="cs-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />}
        <input
          className="cs-input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus={mode === "login"}
        />
        <input
          className="cs-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />

        {error && <p style={{ color: "var(--cs-danger)", fontSize: 13, margin: 0 }}>{error}</p>}

        <button className="cs-btn" type="submit" disabled={submitting} style={{ justifyContent: "center" }}>
          {submitting && <Loader2 size={14} className="cs-spin" />}
          {mode === "login" ? "Sign in" : "Create account"}
        </button>

        {mode === "login" && (
          <button
            type="button"
            data-testid="forgot-password"
            onClick={() => {
              if (!email.trim()) {
                setError("Enter your email address first, then choose 'Forgot password'.");
                return;
              }
              setError(null);
              requestPasswordReset(email.trim())
                .then(setResetNotice)
                .catch(() => setResetNotice("If that address has an account, we've sent a reset link."));
            }}
            style={{ background: "none", border: "none", color: "var(--cs-text-muted)", fontSize: 12, cursor: "pointer", padding: 0 }}
          >
            Forgot password?
          </button>
        )}

        {resetNotice && (
          <p style={{ fontSize: 12, color: "var(--cs-text-muted)", margin: 0 }} data-testid="reset-notice">
            {resetNotice}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "login" ? "register" : "login"));
            setError(null);
          }}
          style={{ background: "none", border: "none", color: "var(--cs-text-muted)", fontSize: 12, cursor: "pointer", padding: 0 }}
        >
          {mode === "login" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </Modal>
  );
}
