import type { ReactNode } from "react";
import type { BadgeInfo, LevelProgress } from "../api/gamification";

/** Level, points and badges — the visible half of the points system,
 * shown as a horizontal stat row (a modern account-page pattern) rather
 * than a paragraph. Every number here is real: nothing here is a
 * follower/like count this app doesn't track. */
export function ProfileStats({ stats, badges }: { stats: LevelProgress; badges: BadgeInfo[] }) {
  // How far through the current level, for the bar. Null next_level_at
  // means the top of the table — show it full.
  const span = stats.next_level_at === null ? 1 : Math.max(1, stats.next_level_at - (stats.points - (stats.points_to_next ?? 0)));
  const filled = stats.next_level_at === null ? 1 : Math.min(1, Math.max(0, 1 - (stats.points_to_next ?? 0) / span));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="profile-stats">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          background: "var(--cs-surface-soft)",
          border: "1px solid var(--cs-border)",
          borderRadius: 12,
        }}
      >
        <StatCell first>
          <strong data-testid="profile-level" style={{ fontSize: 16, lineHeight: 1.2 }}>
            Level {stats.level} · {stats.level_name}
          </strong>
          <span style={{ fontSize: 12, color: "var(--cs-text-muted)" }}>
            {stats.points_to_next === null ? "Top level reached" : `${stats.points_to_next} to next level`}
          </span>
        </StatCell>

        <StatCell>
          <span data-testid="profile-points" style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>
            {stats.points} point{stats.points === 1 ? "" : "s"}
            {stats.reactions_received > 0 && ` · ${stats.reactions_received} reaction${stats.reactions_received === 1 ? "" : "s"} received`}
          </span>
          <span style={{ fontSize: 12, color: "var(--cs-text-muted)" }}>earned so far</span>
        </StatCell>

        <StatCell>
          <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{badges.length}</span>
          <span style={{ fontSize: 12, color: "var(--cs-text-muted)" }}>badge{badges.length === 1 ? "" : "s"} earned</span>
        </StatCell>
      </div>

      <div style={{ height: 6, borderRadius: 3, background: "var(--cs-surface-soft)", overflow: "hidden" }}>
        <div style={{ width: `${filled * 100}%`, height: "100%", background: "var(--cs-accent)" }} />
      </div>

      {badges.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }} data-testid="profile-badges">
          {badges.map((b) => (
            <span
              key={b.id}
              data-testid="profile-badge"
              title={`${b.description}${b.automatic ? "" : " (awarded by the team)"}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 13,
                padding: "3px 8px",
                borderRadius: 999,
                border: "1px solid var(--cs-border-strong)",
                background: "var(--cs-surface-soft)",
              }}
            >
              <span aria-hidden>{b.icon}</span> {b.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One cell of the stat row — a value on top, a short muted caption
 * underneath, divided from its neighbor by a hairline. */
function StatCell({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return (
    <div
      style={{
        flex: "1 1 130px",
        minWidth: 110,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "10px 14px",
        borderLeft: first ? "none" : "1px solid var(--cs-border)",
      }}
    >
      {children}
    </div>
  );
}
