import { useState } from "react";
import { Loader2, Flag } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { REPORT_REASONS, reportContent, type ReportableType } from "../api/profiles";
import { Modal } from "./Modal";

interface ReportModalProps {
  type: ReportableType;
  id: string;
  /** What's being reported, for the dialog's own copy. */
  label: string;
  onClose: () => void;
}

/** One report dialog for every content type — see the backend's
 * ReportController. Filing is all it does: nothing is hidden or actioned
 * automatically, and the dialog says so rather than implying otherwise. */
export function ReportModal({ type, id, label, onClose }: ReportModalProps) {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0].value);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await reportContent(type, id, reason, details);
      setDone(true);
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't send that report — check your connection and try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`Report ${label}`}
      onClose={onClose}
      width="min(420px, 92vw)"
      stacked
      onSubmit={() => void submit()}
      footer={
        done ? (
          <button type="button" className="cs-btn cs-active" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className="cs-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="cs-btn cs-active" disabled={submitting} data-testid="report-submit">
              {submitting ? <Loader2 size={14} className="cs-spin" /> : <Flag size={14} />} Send report
            </button>
          </>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
        {done ? (
          <p style={{ margin: 0, fontSize: 13 }} data-testid="report-done">
            Thanks — this has been sent for review. Nothing is hidden automatically; someone will look at it.
          </p>
        ) : (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--cs-text-muted)" }}>
              Reason
              <select className="cs-input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="report-reason">
                {REPORT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--cs-text-muted)" }}>
              Details (optional)
              <textarea
                className="cs-input"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={4}
                placeholder="What's wrong with it?"
                data-testid="report-details"
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
            </label>

            {error && <p style={{ color: "var(--cs-danger)", fontSize: 13, margin: 0 }}>{error}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
