import type { ReactNode } from "react";

/**
 * The page equivalent of Modal's chrome: a title bar, an optional pinned
 * toolbar, and a scrolling body. Views hand a panel's render-prop slots
 * straight into this, which is what lets the same panel be a dialog in
 * the embed and a page in the app.
 *
 * Centred with a max width on wide screens — a list of templates stretched
 * across a 27" monitor is unreadable — and full-bleed on a phone.
 */
export function Page({ title, subtitle, toolbar, children, actions, testId = "page" }: { title: string; subtitle?: string; toolbar?: ReactNode; children: ReactNode; actions?: ReactNode; testId?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--cs-surface)" }} data-testid={testId}>
      <div style={{ width: "100%", maxWidth: 880, margin: "0 auto", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 10px", flex: "none" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="cs-heading" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
              {title}
            </h1>
            {subtitle && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--cs-text-muted)" }}>{subtitle}</p>}
          </div>
          {actions}
        </div>

        {toolbar && (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
              padding: "10px 16px",
              borderTop: "1px solid var(--cs-border)",
              borderBottom: "1px solid var(--cs-border)",
              flex: "none",
            }}
          >
            {toolbar}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 8px 24px" }}>{children}</div>
      </div>
    </div>
  );
}
