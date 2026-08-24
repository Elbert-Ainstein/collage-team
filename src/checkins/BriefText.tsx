"use client";

// Links in a brief.
//
// activities.source_text is one plain-text column with no markup in it, and it
// is the only place an instructor can say "the reading is here" or "the data is
// in this sheet". Rendered as characters, a pasted URL is dead: the only way to
// follow it is to select forty characters without missing one and paste them
// into a bar.
//
// BOTH forms are read, because they are written by different hands at different
// moments. A bare URL is what a paste produces, and nobody writing a brief at
// 11pm should have to learn a syntax to get one working. [label](url) is what
// you reach for when the link has a name — "the 1975 dataset" reads better in a
// sentence than a query string does, and a brief is prose. Taking only the
// markdown form would leave the common case broken; taking only bare URLs makes
// every brief that cites three things a wall of them.
//
// SECURITY. Faculty-authored text rendered to the whole class is untrusted text
// rendered to the whole class, so:
//
//   - nothing here goes near dangerouslySetInnerHTML. The pieces come back as
//     React elements and text nodes, so there is no path from what someone
//     types to markup the browser will parse.
//   - the scheme is an ALLOW-list of http and https. javascript: and data: are
//     the two that matter, and an anchor is all either of them needs.
//   - a refused URL renders as the characters that were typed, never as a
//     stripped-out nothing. The person who can fix a broken link is the person
//     who wrote it, and they can only fix what they can see.
//
// Text with no links in it comes back as itself, so a caller that renders this
// inside the <p> it already had renders exactly what it rendered before.

import type { ReactNode } from "react";

/**
 * Markdown link first, bare URL second — the order is what stops the URL inside
 * a `(...)` being matched a second time on its own.
 *
 * The markdown arm refuses parentheses in the URL rather than trying to balance
 * them: `[a](b)c)` has no reading that is worth guessing at, and the bare arm
 * below is where the awkward real URLs are handled.
 */
const LINK = /\[([^\]\n]+)\]\(([^()\s]+)\)|((?:https?:\/\/|www\.)[^\s<>]+)/gi;

/** Sentence punctuation that follows a URL far more often than it belongs to one. */
const TRAILING = ".,;:!?'\"";

const LINK_STYLE = {
  color: "inherit",
  textDecoration: "underline",
  textUnderlineOffset: 2,
} as const;

function parensBalanced(s: string): boolean {
  let depth = 0;
  for (const c of s) {
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
  }
  return depth >= 0;
}

/**
 * Split a bare URL from the punctuation that ended the sentence it sat in.
 *
 * "See https://example.org/notes." is one sentence and one URL, and the full
 * stop belongs to the sentence. The bracket rule is the interesting half: a URL
 * ending in ")" is usually a Wikipedia article and the bracket is part of the
 * address, while one ending in an UNMATCHED ")" is a URL somebody put in
 * parentheses. Counting is the only way to tell them apart.
 */
function splitTail(raw: string): [url: string, tail: string] {
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1];
    if (TRAILING.includes(ch)) {
      end -= 1;
      continue;
    }
    if (ch === ")" && !parensBalanced(raw.slice(0, end))) {
      end -= 1;
      continue;
    }
    break;
  }
  return [raw.slice(0, end), raw.slice(end)];
}

/**
 * The href to put on an anchor, or null for "render this as text".
 *
 * Parsing rather than pattern-matching the scheme: `java\nscript:alert(1)` and
 * `JaVaScript:alert(1)` are both accepted by a browser's URL parser and by a
 * naive startsWith check, and only one of them is looking at the string the
 * same way the browser will. Ask the parser what the protocol is, then check it
 * against the two we allow.
 */
function safeHref(raw: string): string | null {
  // The one completion made for anyone: a bare www. is a URL to a person and
  // half a URL to the parser, and https is the only scheme it gets promoted to.
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
}

/**
 * The pieces of a brief, ready to sit inside whatever <p> the caller already
 * had. Inline on purpose — it carries no block styling of its own, so the
 * measure, colour and size stay the caller's.
 */
export function BriefText({ text }: { text: string }): JSX.Element {
  const out: ReactNode[] = [];
  let at = 0;

  // The pattern is module-level and global, so lastIndex survives between
  // renders. Reset it here rather than building a new RegExp per call.
  LINK.lastIndex = 0;
  for (let m = LINK.exec(text); m; m = LINK.exec(text)) {
    const [whole, label, mdUrl, bare] = m;
    const [rawUrl, tail] = mdUrl ? [mdUrl, ""] : splitTail(bare ?? "");
    const href = safeHref(rawUrl);

    if (m.index > at) out.push(text.slice(at, m.index));
    if (!href) {
      out.push(whole);
    } else {
      // A whitespace-only label is an invisible link. Show the address instead:
      // a link nobody can see is a link nobody can click.
      const shown = label && label.trim() ? label : rawUrl;
      out.push(
        <a
          key={m.index}
          href={href}
          // Both, always. target="_blank" alone hands the new tab a
          // window.opener pointing at this app.
          target="_blank"
          rel="noopener noreferrer"
          style={LINK_STYLE}
        >
          {shown}
        </a>,
      );
      if (tail) out.push(tail);
    }
    at = m.index + whole.length;
  }
  out.push(text.slice(at));

  return <>{out}</>;
}
