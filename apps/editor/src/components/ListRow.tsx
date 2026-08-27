import type { ReactNode } from "react";

/** One row in any of the app's listing dialogs — saved designs, templates,
 * collections, a profile's published work. Title, muted subtitle, and
 * whatever actions the caller puts on the right. */
export function ListRow({
  title,
  subtitle,
  icon,
  onClick,
  active = false,
  dimmed = false,
  testId,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  /** Highlighted — e.g. the design currently open in the editor. */
  active?: boolean;
  /** Mid-request. */
  dimmed?: boolean;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px",
        borderRadius: 6,
        marginBottom: 2,
        cursor: onClick && !active ? "pointer" : "default",
        background: active ? "var(--cs-accent-soft)" : "transparent",
        opacity: dimmed ? 0.6 : 1,
      }}
    >
      {icon && <span style={{ display: "flex", flex: "none", color: "var(--cs-text-muted)" }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: "var(--cs-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}
