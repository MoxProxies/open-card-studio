import type { CSSProperties } from "react";

/**
 * A single shimmering placeholder block — the one shared primitive every
 * page-level skeleton in this app composes. Deliberately just a themed
 * `<div>`: pages build their own layout out of a few of these (a circle
 * for an avatar, short rects for text lines, a taller one for a
 * thumbnail) positioned where the real content will land, rather than
 * each page inventing its own placeholder markup. See SkeletonListRows
 * and SkeletonCardGrid below for the two shapes shared across several
 * pages, and ProfilePanel.tsx for a bespoke composition (header).
 *
 * Only meant for a page/panel's initial content load — the moment the
 * whole body is still fetching and today shows nothing but a centered
 * spinner + "Loading…" line. A spinner mid-button-submit, or a small
 * inline one in a search-as-you-type dropdown, stays a spinner: there's
 * no content shape to echo for those, and the wait is short.
 */
export function Skeleton({
  width = "100%",
  height = 14,
  radius = 6,
  circle = false,
  style,
  className,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  /** Round to a full circle (an avatar) instead of `radius`. */
  circle?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`cs-skeleton${className ? ` ${className}` : ""}`}
      style={{ width, height, borderRadius: circle ? "50%" : radius, flex: "none", ...style }}
    />
  );
}

/**
 * ListRow-shaped skeleton rows — CollectionsPanel, LibraryPanel,
 * GuidesView and ModerationView all list plain `ListRow`s (a small
 * leading icon, a title line, a shorter subtitle line) as their
 * page-level content, so this one composition covers all four.
 */
export function SkeletonListRows({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden data-testid="skeleton-list-rows">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px" }}>
          <Skeleton circle width={18} height={18} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <Skeleton height={15} width={`${55 - (i % 3) * 8}%`} />
            <Skeleton height={12} width={`${30 - (i % 2) * 6}%`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Card-grid-shaped skeletons — TemplatesPanel's browse/mine grid and
 * ProfilePanel's own tab content share the exact same card shape
 * (`.cs-tb-grid` / `.cs-tb-card` / `.cs-tb-card-body`, see styles.css),
 * so reusing those classes here keeps the placeholder's geometry
 * identical to the real cards that replace it — no layout jump.
 */
export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="cs-tb-grid" aria-hidden data-testid="skeleton-card-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="cs-tb-card">
          <Skeleton height="auto" radius={0} style={{ aspectRatio: "16 / 10" }} />
          <div className="cs-tb-card-body">
            <Skeleton height={15} width="70%" />
            <Skeleton height={12} width="45%" />
          </div>
        </div>
      ))}
    </div>
  );
}
