import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldAlert, EyeOff, Eye, UserX, UserCheck, ScrollText, Check, X, MessageSquareWarning } from "lucide-react";
import { apiErrorMessage } from "../../api/client";
import {
  loadAppealQueue,
  loadAuditTrail,
  loadReportQueue,
  resolveAppeal,
  resolveReport,
  suspendUser,
  takedown,
  type AuditEntry,
  type QueuedAppeal,
  type QueuedReport,
  type ReportState,
} from "../../api/moderation";
import { ListRow } from "../../components/ListRow";
import { navigate } from "../navStore";
import { Page } from "../Page";

/**
 * The staff report queue. Deliberately manual: a human reads a report and
 * decides — nothing auto-hides at a report threshold, and there are no
 * heuristics. That's the "founders review a queue" shape
 * docs/PRODUCT_VISION.md leaves open, and the one that needs the least
 * tooling to be safe. If it stops scaling, this queue is where automation
 * would attach.
 *
 * Only reachable when the account is staff — and the API 404s for
 * everyone else, so hiding the tab is presentation, not the security
 * boundary.
 */
export function ModerationView() {
  const [tab, setTab] = useState<"queue" | "appeals" | "audit">("queue");
  const [state, setState] = useState<ReportState | "all">("open");
  const [reports, setReports] = useState<QueuedReport[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [appeals, setAppeals] = useState<QueuedAppeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    (tab === "audit" ? loadAuditTrail().then(setAudit) : tab === "appeals" ? loadAppealQueue().then(setAppeals) : loadReportQueue(state).then(setReports))
      .catch((e: unknown) => setError(apiErrorMessage(e, "Couldn't load the moderation queue.")))
      .finally(() => setLoading(false));
  }, [tab, state]);

  useEffect(refresh, [refresh]);

  const act = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      refresh();
    } catch (e) {
      setError(apiErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const remove = (report: QueuedReport) => {
    const reason = window.prompt(`Why is “${report.target.label ?? report.target.id}” being removed? This is recorded in the audit trail.`);
    if (!reason) return;
    void act(async () => {
      await takedown(report.target.type, report.target.id, true, reason);
      await resolveReport(report.id, "actioned", reason);
    }, "Couldn't take that down.");
  };

  const suspend = (report: QueuedReport) => {
    const reason = window.prompt("Why is this account being suspended? This is recorded in the audit trail.");
    if (!reason) return;
    void act(async () => {
      await suspendUser(Number(report.target.id), true, reason);
      await resolveReport(report.id, "actioned", reason);
    }, "Couldn't suspend that account.");
  };

  const decide = (appeal: QueuedAppeal, granted: boolean) => {
    // Required either way: "no" with no reason is what makes someone file
    // the same appeal five more times. The backend enforces it too.
    const response = window.prompt(
      granted ? "What are you telling them? Granting also lifts the suspension." : "Why is this being declined? They see this text.",
    );
    if (!response) return;
    void act(() => resolveAppeal(appeal.id, granted ? "granted" : "denied", response), "Couldn't record that decision.");
  };

  return (
    <Page
      testId="page-moderation"
      title="Moderation"
      subtitle="Reports people have filed. Nothing here is automatic — every action is yours, and every action is logged."
      toolbar={
        <>
          <button className={`cs-btn${tab === "queue" ? " cs-active" : ""}`} onClick={() => setTab("queue")} data-testid="mod-tab-queue">
            <ShieldAlert size={14} /> Queue
          </button>
          <button className={`cs-btn${tab === "appeals" ? " cs-active" : ""}`} onClick={() => setTab("appeals")} data-testid="mod-tab-appeals">
            <MessageSquareWarning size={14} /> Appeals
          </button>
          <button className={`cs-btn${tab === "audit" ? " cs-active" : ""}`} onClick={() => setTab("audit")} data-testid="mod-tab-audit">
            <ScrollText size={14} /> Audit trail
          </button>
          {tab === "queue" && (
            <select
              className="cs-input"
              value={state}
              onChange={(e) => setState(e.target.value as ReportState | "all")}
              style={{ width: 150 }}
              data-testid="mod-state"
            >
              <option value="open">Open</option>
              <option value="reviewed">Reviewed</option>
              <option value="actioned">Actioned</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All</option>
            </select>
          )}
        </>
      }
    >
      {error && <p style={{ color: "var(--cs-danger)", fontSize: 13, padding: "6px 8px" }}>{error}</p>}

      {loading ? (
        <p style={{ padding: "6px 8px", fontSize: 13, color: "var(--cs-text-muted)", display: "flex", gap: 6, alignItems: "center" }}>
          <Loader2 size={14} className="cs-spin" /> Loading…
        </p>
      ) : tab === "appeals" ? (
        appeals.length === 0 ? (
          <p style={{ padding: "6px 8px", fontSize: 13, color: "var(--cs-text-muted)" }} data-testid="appeals-empty">
            No open appeals.
          </p>
        ) : (
          appeals.map((a) => (
            <ListRow
              key={a.id}
              testId="appeal-row"
              attrs={{ "data-appeal-id": a.id }}
              title={`${a.user.name ?? "someone"} — “${a.message}”`}
              subtitle={`appealed ${new Date(a.submitted_at).toLocaleDateString()}${a.user.suspended ? "" : " · already reinstated"}`}
            >
              <button className="cs-btn" disabled={busy} onClick={() => decide(a, true)} data-testid="appeal-grant" title="Grant and reinstate">
                <UserCheck size={14} /> Grant
              </button>
              <button className="cs-btn" disabled={busy} onClick={() => decide(a, false)} data-testid="appeal-deny" title="Decline this appeal">
                <X size={14} /> Decline
              </button>
              {a.user.username && (
                <button className="cs-btn" onClick={() => navigate({ tab: "profile", username: a.user.username as string })} title="See the account">
                  Profile
                </button>
              )}
            </ListRow>
          ))
        )
      ) : tab === "audit" ? (
        audit.length === 0 ? (
          <p style={{ padding: "6px 8px", fontSize: 13, color: "var(--cs-text-muted)" }}>Nothing has been actioned yet.</p>
        ) : (
          audit.map((a) => (
            <ListRow
              key={a.id}
              testId="audit-row"
              title={`${a.action} · ${a.target_type.split("\\").pop()} ${a.target_id}`}
              subtitle={`${a.actor ?? "someone"} · ${new Date(a.at).toLocaleString()}${a.reason ? ` · ${a.reason}` : ""}`}
            />
          ))
        )
      ) : reports.length === 0 ? (
        <p style={{ padding: "6px 8px", fontSize: 13, color: "var(--cs-text-muted)" }} data-testid="mod-empty">
          Nothing in the queue. {state === "open" && "That's the good outcome."}
        </p>
      ) : (
        reports.map((r) => (
          <ListRow
            key={r.id}
            testId="report-row"
            attrs={{ "data-report-id": r.id, "data-target-id": r.target.id, "data-target-type": r.target.type }}
            title={r.target.gone ? `${r.target.type} (deleted)` : (r.target.label ?? `${r.target.type} ${r.target.id}`)}
            subtitle={
              <>
                {r.reason} · reported by {r.reporter.name ?? "someone"} · {new Date(r.reported_at).toLocaleDateString()}
                {r.details && ` · “${r.details}”`}
                {r.target.moderation_state === "removed" && " · already removed"}
              </>
            }
          >
            {r.target.type === "user" ? (
              <button className="cs-btn" disabled={busy} onClick={() => suspend(r)} data-testid="mod-suspend" title="Suspend this account">
                <UserX size={14} /> Suspend
              </button>
            ) : (
              !r.target.gone && (
                <button
                  className="cs-btn"
                  disabled={busy}
                  onClick={() =>
                    r.target.moderation_state === "removed" ? void act(() => takedown(r.target.type, r.target.id, false), "Couldn't restore that.") : remove(r)
                  }
                  data-testid="mod-takedown"
                >
                  {r.target.moderation_state === "removed" ? <Eye size={14} /> : <EyeOff size={14} />}
                  {r.target.moderation_state === "removed" ? "Restore" : "Remove"}
                </button>
              )
            )}
            <button
              className="cs-icon-btn"
              title="Dismiss — no action needed"
              disabled={busy}
              onClick={() => void act(() => resolveReport(r.id, "dismissed"), "Couldn't dismiss.")}
              data-testid="mod-dismiss"
            >
              <X size={14} />
            </button>
            <button
              className="cs-icon-btn"
              title="Mark reviewed"
              disabled={busy}
              onClick={() => void act(() => resolveReport(r.id, "reviewed"), "Couldn't update.")}
              data-testid="mod-reviewed"
            >
              <Check size={14} />
            </button>
            {typeof r.target.owner === "string" && (
              <button className="cs-btn" onClick={() => navigate({ tab: "profile", username: r.target.owner as string })} title="See the account">
                Profile
              </button>
            )}
          </ListRow>
        ))
      )}
    </Page>
  );
}
