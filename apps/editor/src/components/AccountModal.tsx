import { useState } from "react";
import { Loader2 } from "lucide-react";
import { login, register } from "../api/auth";
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
