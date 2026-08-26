import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { login, register } from "../api/auth";
import { ApiError } from "../api/client";

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

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
      setError(e instanceof ApiError ? e.message : "Something went wrong — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="cs-root"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: "fixed", inset: 0, background: "var(--cs-backdrop)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{
          background: "var(--cs-surface)",
          borderRadius: 12,
          width: "min(360px, 92vw)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 50px var(--cs-shadow)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--cs-border)" }}>
          <h2 className="cs-heading" style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: 1 }}>
            {mode === "login" ? "Sign in" : "Create account"}
          </h2>
          <button type="button" className="cs-icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "register" && (
            <input className="cs-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          )}
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
      </form>
    </div>
  );
}
