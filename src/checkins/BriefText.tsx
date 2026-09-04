"use client";

// Links in a brief.
//
// activities.source_text is one plain-text column with no markup in it, and it
// is the only place an instructor can say "the reading is here" or "the data is
// in this sheet". Rendered as characters, a pasted URL is dead: the only way to
// follow it is to select forty characters without missing one and paste them
// into a bar.
//
// THREE forms are read, because they are written by different hands at
// different moments. A bare URL is what a paste produces, and nobody writing a
// brief at 11pm should have to learn a syntax to get one working. [label](url) is what
// you reach for when the link has a name — "the 1975 dataset" reads better in a
// sentence than a query string does, and a brief is prose. Taking only the
// markdown form would leave the common case broken; taking only bare URLs makes
// every brief that cites three things a wall of them.
//
// The third is `[label](file:<path>)`, which points at a file the activity is
// already carrying rather than at somewhere on the web — the shape Canvas has
// trained everyone to expect, where "the case" in a sentence is the thing you
// click to get the case. It is written by the picker in the editor, never typed,
// and it resolves ONLY against the signed files handed to this component. See
// briefLinks.ts for why the text stores a path and not a URL.
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
//   - a file: token mints nothing. It is looked up in the map of files the
//     caller was ALREADY showing this reader, so a path pointing anywhere else
//     — another activity's, a guess — finds nothing and stays words.
//
// Text with no links in it comes back as itself, so a caller that renders this
// inside the <p> it already had renders exactly what it rendered before.

import type { ReactNode } from "react";

import { type BriefFiles, MD_LINK, filePath, withDownload } from "./briefLinks";

/**
 * Markdown link first, bare URL second — the order is what stops the URL inside
 * a `(...)` being matched a second time on its own.
 *
 * The markdown arm comes from briefLinks so the editor writes exactly what this
 * matches; the bare arm is where the awkward real URLs are handled. Groups: 1
 * the label, 2 the markdown target, 3 a bare URL.
 */
const LINK = new RegExp(`${MD_LINK}|((?:https?:\\/\\/|www\\.)[^\\s<>]+)`, "gi");

/** Sentence punctuation that follows a URL far more often than it belongs to one. */
const TRAILING = ".,;:!?'\"";

/**
 * Blue and underlined — what a link has looked like since before any of this,
 * and what people are actually scanning for when they skim a brief for "where
 * is the reading". Inheriting the body colour made a link findable only by
 * noticing an underline inside justified prose, which is not findable.
 *
 * The colour is the palette's own blue, aliased to one name because this
 * renderer is shared by two apps that scope their tokens differently. The
 * literal fallback is the same value, for any surface that renders this outside
 * either scope.
 */
const LINK_STYLE = {
  color: "var(--brief-link, rgb(31, 102, 163))",
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
/**
 * The security boundary of this file, and the reason it is exported: this text
 * is written by faculty and rendered to eighty students, and the ONE thing that
 * must never happen is a javascript: or data: URL becoming a live link. That is
 * a claim worth a test rather than a comment.
 */
export function safeHref(raw: string): string | null {
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
 * A down-arrow after a file link, so it reads as "this saves something" before
 * it is clicked rather than after.
 *
 * Inline SVG rather than an icon component: this file is shared by the faculty
 * and student apps, which have separate icon sets, and importing either one
 * here would make the shared renderer pick a side. currentColor and `em` sizing
 * keep it the size and colour of the sentence it sits in.
 */
function DownloadGlyph(): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="0.85em"
      height="0.85em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: the link's own words already say what it is, and a second
      // announcement of "download" on every one of them is noise in a reader.
      aria-hidden="true"
      focusable="false"
      style={{ marginLeft: "0.25em", verticalAlign: "-0.08em", flexShrink: 0 }}
    >
      <path d="M8 2.5v7.5" />
      <path d="M4.75 7.25 8 10.5l3.25-3.25" />
      <path d="M2.75 13.25h10.5" />
    </svg>
  );
}

/**
 * The pieces of a brief, ready to sit inside whatever <p> the caller already
 * had. Inline on purpose — it carries no block styling of its own, so the
 * measure, colour and size stay the caller's.
 *
 * `files` is optional, and a caller that has none renders exactly what it
 * rendered before this existed.
 */
export function BriefText({ text, files }: { text: string; files?: BriefFiles }): JSX.Element {
  const out: ReactNode[] = [];
  let at = 0;

  // The pattern is module-level and global, so lastIndex survives between
  // renders. Reset it here rather than building a new RegExp per call.
  LINK.lastIndex = 0;
  for (let m = LINK.exec(text); m; m = LINK.exec(text)) {
    const [whole, label, mdUrl, bare] = m;
    const [rawUrl, tail] = mdUrl ? [mdUrl, ""] : splitTail(bare ?? "");

    if (m.index > at) out.push(text.slice(at, m.index));

    // A file the activity carries, named rather than addressed. Only the
    // markdown arm can be one — a bare URL has to start http or www.
    const path = mdUrl ? filePath(mdUrl) : null;
    if (path) {
      const file = files?.get(path);
      if (file) {
        out.push(
          <a
            key={m.index}
            href={withDownload(file.href, file.name)}
            // Ignored cross-origin, and storage IS another origin, so the
            // query parameter above is what actually saves the file. Kept
            // because it costs nothing and states the intent to a reader.
            download={file.name}
            // No target: a download that opens a blank tab first leaves an
            // empty window behind on every click.
            rel="noopener noreferrer"
            style={LINK_STYLE}
          >
            {label && label.trim() ? label : file.name}
            <DownloadGlyph />
          </a>,
        );
      } else {
        // Not resolvable: still being signed on first paint, or attached once
        // and since removed. Either way the WORDS go out, not the token —
        // students would otherwise watch raw markup flash on every page load,
        // and a brief whose sentence still reads is worth more than one
        // advertising a path nobody outside this app can act on.
        out.push(label && label.trim() ? label : whole);
      }
      at = m.index + whole.length;
      continue;
    }

    const href = safeHref(rawUrl);
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
