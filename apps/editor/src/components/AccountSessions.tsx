import { useEffect, useState } from "react";
import { Loader2, MonitorSmartphone, X } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { loadSessions, revokeSession, type AuthSession } from "../api/auth";
import { ListRow } from "./ListRow";

/**
 * The account's signed-in devices. The point of showing them is the one
 * you don't recognise: "sign out everywhere" is the blunt version of this
 * and costs you every other device, so a per-session revoke is what you
 * actually want when only one of them is a problem.
 */
export function AccountSessions({ onSignedOut }: { onSignedOut: () => void }) {
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    loadSessions()
      .then(setSessions)
      .catch((e) => setError(apiErrorMessage(e, "Couldn't load your signed-in devices.")));

  useEffect(() => {
    void refresh();
  }, []);

  const revoke = async (session: AuthSession) => {
    if (session.current && !window.confirm("That's this device — revoking it signs you out here.")) return;
    setBusy(session.id);
    setError(null);
    try {
      // revokeSession has already cleared the local token when it was
      // this device's, so there's nothing left to refresh — the caller
      // closes instead.
      if (await revokeSession(session.id)) return onSignedOut();
      await refresh();
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't end that session."));
    } finally {
      setBusy(null);
    }
  };

  if (!sessions) return <p style={{ fontSize: 12, color: "var(--cs-text-muted)", margin: 0 }}>{error ?? "Loading devices…"}</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }} data-testid="account-sessions">
      {sessions.map((session) => (
        <ListRow
          key={session.id}
          testId="session-row"
          attrs={{ "data-current": String(session.current) }}
          icon={<MonitorSmartphone size={15} />}
          title={session.current ? `${session.device} — this device` : session.device}
          subtitle={
            session.last_used_at ? `Last used ${new Date(session.last_used_at).toLocaleString()}` : `Signed in ${new Date(session.created_at).toLocaleString()}`
          }
        >
          <button
            type="button"
            className="cs-icon-btn"
            data-testid="session-revoke"
            title={session.current ? "Sign out on this device" : "End this session"}
            disabled={busy === session.id}
            onClick={() => void revoke(session)}
          >
            {busy === session.id ? <Loader2 size={14} className="cs-spin" /> : <X size={14} />}
          </button>
        </ListRow>
      ))}
      {error && <p style={{ color: "var(--cs-danger)", fontSize: 12, margin: 0 }}>{error}</p>}
    </div>
  );
}
