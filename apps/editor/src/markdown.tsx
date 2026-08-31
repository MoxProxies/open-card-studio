import type { ReactNode } from "react";

/**
 * A small markdown subset, rendered to **React elements** — never to an
 * HTML string, and with no `dangerouslySetInnerHTML` anywhere.
 *
 * That's the whole design. Post bodies are user-generated and public, so
 * the usual markdown-to-HTML pipeline would need a sanitizer, and a
 * sanitizer is a thing you can get subtly wrong. Building React nodes
 * instead makes injection impossible by construction: text goes into
 * text nodes, and the only tags that exist are the ones this file
 * creates. Link hrefs are still checked against a scheme allowlist,
 * because `javascript:` in an href isn't markup injection.
 *
 * Supported: #/##/### headings, paragraphs, - and 1. lists, > quotes,
 * ``` fences, --- rules, and inline **bold**, *italic*, `code` and
 * [links](url). Anything else renders as plain text, which is the right
 * failure mode for a guide.
 */

// The trailing `/` alternative is for same-site links like `/guides/x` —
// it must not also match a protocol-relative URL like `//evil.example.com`,
// which starts with a slash too but resolves off-site. Nor a backslash
// variant like `/\evil.example.com`: browsers normalize a leading `\` to
// `/` at the start of a URL's path per the WHATWG URL spec, so that's
// browser-equivalent to `//evil.example.com` too, just spelled to look
// same-site. Requiring the `/` not be followed by a second `/` or a `\`
// keeps genuine same-site links and rejects both off-site spellings.
const SAFE_SCHEME = /^(https?:\/\/|mailto:|#|\/(?!\/|\\))/i;

/** Inline spans: bold, italic, code, links. Order matters — code wins, so
 * `**not bold**` inside backticks stays literal. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;

    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} style={{ background: "var(--cs-surface-soft)", padding: "1px 4px", borderRadius: 3, fontSize: "0.92em" }}>
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);

      // A link whose scheme isn't allowlisted renders as its own text —
      // visible, inert, and obviously not a link.
      nodes.push(
        SAFE_SCHEME.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow ugc" style={{ color: "var(--cs-accent)" }}>
            {label}
          </a>
        ) : (
          <span key={key}>{token}</span>
        )
      );
    }

    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));

  return nodes;
}

const HEADING_SIZES = [19, 16, 14];

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={`p${key++}`} style={{ margin: "0 0 10px", lineHeight: 1.6 }}>
        {inline(paragraph.join(" "), `p${key}`)}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    const current = list;
    blocks.push(
      <Tag key={`l${key++}`} style={{ margin: "0 0 10px", paddingLeft: 22, lineHeight: 1.6 }}>
        {current.items.map((item, i) => (
          <li key={i}>{inline(item, `l${key}-${i}`)}</li>
        ))}
      </Tag>
    );
    list = null;
  };

  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (line.trim().startsWith("```")) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) code.push(lines[i++] ?? "");
      blocks.push(
        <pre
          key={`c${key++}`}
          style={{ margin: "0 0 10px", padding: 10, background: "var(--cs-surface-soft)", borderRadius: 6, overflowX: "auto", fontSize: 12, lineHeight: 1.5 }}
        >
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = (heading[1] ?? "#").length;
      const Tag = `h${level + 1}` as "h2";
      blocks.push(
        <Tag key={`h${key++}`} className="cs-heading" style={{ fontSize: HEADING_SIZES[level - 1], fontWeight: 600, margin: "16px 0 8px" }}>
          {inline(heading[2] ?? "", `h${key}`)}
        </Tag>
      );
      continue;
    }

    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      flush();
      blocks.push(<hr key={`r${key++}`} style={{ border: "none", borderTop: "1px solid var(--cs-border)", margin: "14px 0" }} />);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      blocks.push(
        <blockquote
          key={`q${key++}`}
          style={{ margin: "0 0 10px", padding: "4px 0 4px 12px", borderLeft: "3px solid var(--cs-border-strong)", color: "var(--cs-text-muted)" }}
        >
          {inline(quote[1] ?? "", `q${key}`)}
        </blockquote>
      );
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1] ?? "");
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flush();

  return <div style={{ fontSize: 14 }}>{blocks}</div>;
}
