import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Search, Loader2, LayoutTemplate, BookOpen, FolderOpen } from "lucide-react";
import { apiErrorMessage } from "../api/client";
import { getCurrentUser, subscribe } from "../api/auth";
import { loadTemplate, markTemplateUsed } from "../api/templates";
import { globalSearch, type SearchResults } from "../api/search";
import { designFromTemplate } from "../cardTemplates";
import { designStorage } from "../designStorage";
import { useDesignStore } from "../store/DesignProvider";
import { navigate } from "../shell/navStore";
import { ListRow } from "./ListRow";

const EMPTY: SearchResults = { templates: [], guides: [], designs: [] };

/**
 * The top bar's search icon and what it opens — a compact popover rather
 * than a permanently-expanded input, the way the Audible app's header
 * does it (see Nav.tsx's TopNav and AppShell.tsx's mobile header, the two
 * places this mounts).
 *
 * Backed by GET /api/search (api/search.ts): published templates,
 * published guides, and — only once signed in — the requester's own
 * library. Works for guests too; `designs` just comes back empty for
 * them, same as the endpoint's own doc comment says, so this never gates
 * the search UI itself behind sign-in.
 *
 * Picking a result reuses the exact action that destination already has:
 * a template goes through loadTemplate + designFromTemplate, same as
 * TemplatesPanel's "Use"; a guide navigates to its slug, same as
 * GuidesView's list; a design loads through designStorage, same as
 * LibraryPanel's "load". Nothing here re-implements any of those.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const loadDesign = useDesignStore((s) => s.loadDesign);

  const close = () => {
    setOpen(false);
    setQuery("");
    setResults(EMPTY);
    setError(null);
    setBusyId(null);
  };

  // Focus the input as soon as the popover mounts, and close on an
  // outside click or Escape — same pattern as TextTemplateMenu.tsx's
  // toolbar dropdown, composedPath() included for the same shadow-root
  // reason (the embed renders into one — see embed.ts).
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    const handleClick = (e: MouseEvent) => {
      const target = (e.composedPath()[0] ?? e.target) as Node;
      if (rootRef.current && !rootRef.current.contains(target)) close();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  // Debounced, same 200-250ms shape as TemplatesPanel/GuidesView use for
  // their own search boxes — server-side filtering, so it isn't worth
  // firing a request per keystroke.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(EMPTY);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      globalSearch(trimmed)
        .then(setResults)
        .catch((e: unknown) => setError(apiErrorMessage(e, "Search failed. Check your connection and try again.")))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Same confirm-then-clone flow as TemplatesPanel.handleUse.
  const handleUseTemplate = async (id: string, name: string) => {
    if (!window.confirm(`Start a new design from "${name}"? Any unsaved changes to the current one will be lost.`)) return;
    setBusyId(id);
    setError(null);
    try {
      const template = await loadTemplate(id);
      void markTemplateUsed(id).catch(() => {});
      loadDesign(designFromTemplate(template));
      navigate({ tab: "design" });
      close();
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't open that template. Check your connection and try again."));
      setBusyId(null);
    }
  };

  const handleOpenGuide = (slug: string) => {
    navigate({ tab: "guides", slug });
    close();
  };

  // Same confirm-then-load flow as LibraryPanel.handleLoad.
  const handleOpenDesign = async (id: string, name: string) => {
    if (!window.confirm(`Load "${name}"? Any unsaved changes to the current design will be lost.`)) return;
    setBusyId(id);
    setError(null);
    try {
      const loaded = await designStorage.load(id);
      if (loaded) {
        loadDesign(loaded);
        navigate({ tab: "design" });
        close();
      } else {
        setError("That design couldn't be found. It may have been deleted elsewhere.");
        setBusyId(null);
      }
    } catch (e) {
      setError(apiErrorMessage(e, "Couldn't load that design. Check your connection and try again."));
      setBusyId(null);
    }
  };

  const trimmed = query.trim();
  const hasResults = results.templates.length + results.guides.length + results.designs.length > 0;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        className={`cs-icon-btn${open ? " cs-active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Search"
        aria-label="Search templates, guides and your library"
        data-testid="global-search-toggle"
      >
        <Search size={16} />
      </button>

      {open && (
        <div className="cs-root cs-search-panel" data-testid="global-search-panel">
          <div style={{ position: "relative", padding: 8, borderBottom: "1px solid var(--cs-border)", flex: "none" }}>
            <Search
              size={14}
              style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", color: "var(--cs-text-muted)" }}
            />
            <input
              ref={inputRef}
              className="cs-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates, guides, library"
              style={{ paddingLeft: 30 }}
              data-testid="global-search-input"
            />
          </div>

          <div style={{ overflowY: "auto", padding: 6 }}>
            {!trimmed ? (
              <p style={{ fontSize: 12, color: "var(--cs-text-muted)", padding: "10px 8px", margin: 0 }}>
                Search published templates, guides{user ? ", and your library" : ""}.
              </p>
            ) : loading ? (
              <p style={{ fontSize: 12, color: "var(--cs-text-muted)", padding: "10px 8px", margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                <Loader2 size={13} className="cs-spin" /> Searching
              </p>
            ) : error ? (
              <p style={{ fontSize: 12, color: "var(--cs-danger)", padding: "10px 8px", margin: 0 }}>{error}</p>
            ) : !hasResults ? (
              <p style={{ fontSize: 12, color: "var(--cs-text-muted)", padding: "10px 8px", margin: 0 }} data-testid="global-search-empty">
                No matches for "{trimmed}".
              </p>
            ) : (
              <>
                {results.templates.length > 0 && (
                  <Section title="Templates">
                    {results.templates.map((t) => (
                      <ListRow
                        key={t.id}
                        testId="global-search-template"
                        icon={busyId === t.id ? <Loader2 size={14} className="cs-spin" /> : <LayoutTemplate size={14} />}
                        title={t.name}
                        subtitle={`by ${t.author.name ?? "a community member"}`}
                        onClick={() => void handleUseTemplate(t.id, t.name)}
                        dimmed={busyId === t.id}
                      />
                    ))}
                  </Section>
                )}

                {results.guides.length > 0 && (
                  <Section title="Guides">
                    {results.guides.map((g) => (
                      <ListRow
                        key={g.id}
                        testId="global-search-guide"
                        icon={<BookOpen size={14} />}
                        title={g.title}
                        subtitle={g.categoryLabel}
                        onClick={() => handleOpenGuide(g.slug)}
                      />
                    ))}
                  </Section>
                )}

                {results.designs.length > 0 && (
                  <Section title="Library">
                    {results.designs.map((d) => (
                      <ListRow
                        key={d.id}
                        testId="global-search-design"
                        icon={busyId === d.id ? <Loader2 size={14} className="cs-spin" /> : <FolderOpen size={14} />}
                        title={d.name}
                        subtitle={new Date(d.updatedAt).toLocaleDateString()}
                        onClick={() => void handleOpenDesign(d.id, d.name)}
                        dimmed={busyId === d.id}
                      />
                    ))}
                  </Section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--cs-text-muted)",
          padding: "6px 8px 2px",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
