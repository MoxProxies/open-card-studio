import type { BadgeInfo, LevelProgress } from "../api/gamification";

/** Level, points and badges — the visible half of the points system. A
 * plain bar and a number, deliberately: "why am I level 3" should be
 * answerable by looking, not by reverse-engineering an animation. */
export function ProfileStats({ stats, badges }: { stats: LevelProgress; badges: BadgeInfo[] }) {
  // How far through the current level, for the bar. Null next_level_at
  // means the top of the table — show it full.
  const span = stats.next_level_at === null ? 1 : Math.max(1, stats.next_level_at - (stats.points - (stats.points_to_next ?? 0)));
  const filled = stats.next_level_at === null ? 1 : Math.min(1, Math.max(0, 1 - (stats.points_to_next ?? 0) / span));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="profile-stats">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13 }}>
        <strong data-testid="profile-level">
          Level {stats.level} · {stats.level_name}
        </strong>
        <span style={{ color: "var(--cs-text-muted)", fontSize: 12 }} data-testid="profile-points">
          {stats.points} point{stats.points === 1 ? "" : "s"}
          {stats.reactions_received > 0 && ` · ${stats.reactions_received} reaction${stats.reactions_received === 1 ? "" : "s"} received`}
        </span>
      </div>

      <div style={{ height: 6, borderRadius: 3, background: "var(--cs-surface-soft)", overflow: "hidden" }}>
        <div style={{ width: `${filled * 100}%`, height: "100%", background: "var(--cs-accent)" }} />
      </div>

      <span style={{ fontSize: 11, color: "var(--cs-text-muted)" }}>
        {stats.points_to_next === null ? "Top level reached." : `${stats.points_to_next} to level ${stats.level + 1}.`}
      </span>

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
                fontSize: 11,
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
