// Pointing a phrase in a brief at a file the activity carries.
//
// A brief can already say [the reading](https://…), and for anything living on
// the web that is the whole story. What it could not say is "the reading" and
// mean the PDF sitting in the attachment list two inches below it — which is
// the one every course actually wants. Canvas has done it for a decade and the
// shape people expect is the same one: a phrase you click, and the file lands
// on your machine.
//
// WHY A TOKEN AND NOT A URL. The bucket is private. Every URL that opens one of
// these files is minted per view and expires within the hour — the brief page
// is already re-minting them on a timer so the attachment list stays clickable.
// Writing one into source_text would put a bearer credential in a column the
// whole class reads, and it would be dead by the next lesson regardless. So the
// text stores the one thing about a file that does NOT change — its path in the
// bucket — and the renderer trades that for a URL somebody else is keeping fresh.
//
// WHY THAT IS SAFE. A token only ever resolves against the map of THIS
// activity's signed files. A path that is not in that map — another activity's,
// a guess, a typo, a path typed by hand into the box — resolves to nothing and
// renders as the words that were typed. Nothing in this file can mint a URL, so
// nothing written in a brief can reach a file the reader was not already being
// shown. The token is a name for something on the page, not an address.

import type { FileRef } from "./types";

/** One of the activity's attachments, as the renderer needs it. */
export interface BriefFile {
  /** The short-lived signed URL the attachment list is already keeping fresh. */
  href: string;
  /** The filename — what gets saved, and the words to show if none were given. */
  name: string;
}

/** Path -> file, for the attachments this reader is already being shown. */
export type BriefFiles = ReadonlyMap<string, BriefFile>;

/**
 * The lookup a brief resolves its file: tokens against.
 *
 * Built from the refs and the signed URLs the attachment list already has, so
 * an inline link and the row at the bottom of the card are the same URL with
 * the same expiry, re-minted by the same timer. A ref with no path (written
 * before 0012) or one the backend refused is simply absent, and the phrase that
 * pointed at it renders as words.
 */
export function briefFiles(
  refs: readonly FileRef[],
  urls: ReadonlyMap<string, string>,
): BriefFiles {
  const out = new Map<string, BriefFile>();
  for (const ref of refs) {
    const href = ref.path ? urls.get(ref.path) : undefined;
    if (ref.path && href) out.set(ref.path, { href, name: ref.name });
  }
  return out;
}

/**
 * `[words](target)` — the one shape the renderer and the editor must agree on.
 *
 * Defined here and imported by both, because they are two halves of one format:
 * an editor that writes a link the renderer will not match authors dead text,
 * and the person who finds out is a student. Parentheses are refused in the
 * target rather than balanced — `[a](b)c)` has no reading worth guessing at.
 */
export const MD_LINK = String.raw`\[([^\]\n]+)\]\(([^()\s]+)\)`;

/** Where a link sits in the description, and what it is made of. */
export interface LinkSpan {
  /** Index of the opening `[`. */
  start: number;
  /** Index just past the closing `)`. */
  end: number;
  /** The words a reader sees. */
  label: string;
  /** A URL, or a `file:` token. */
  target: string;
}

/**
 * The link the caret is sitting in, or null if it is not in one.
 *
 * This is what makes ⌘K on an existing link EDIT it rather than nest a second
 * one inside it, which is the behaviour every editor has and the one people
 * reach for without thinking. The whole span comes back — brackets and all — so
 * the caller replaces the link it found instead of writing beside it.
 *
 * A selection has to be inside the link, not merely touch it: half a link and
 * half a sentence is a selection someone made to replace both, and quietly
 * turning it into a link edit would eat the words on the other side.
 */
export function linkAt(text: string, from: number, to: number): LinkSpan | null {
  const re = new RegExp(MD_LINK, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (from >= start && to <= end) {
      return { start, end, label: m[1], target: m[2] };
    }
  }
  return null;
}

/** What a file reference looks like where a URL would go: `file:<encoded path>`. */
const SCHEME = "file:";

/**
 * Percent-encode a bucket path so it can sit inside `[words](…)`.
 *
 * encodeURIComponent is most of it, and then the parentheses by hand: it leaves
 * `(` and `)` alone, and BriefText's markdown arm ends its URL at the first one
 * of those. A file called "notes (final).pdf" is not exotic, and left unencoded
 * it would truncate its own link.
 */
function encodePath(path: string): string {
  return encodeURIComponent(path).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/** The token to write into a brief for the file stored at `path`. */
export function fileToken(path: string): string {
  return `${SCHEME}${encodePath(path)}`;
}

/**
 * The bucket path a token names, or null if this is not one.
 *
 * Null rather than a throw for malformed input: what arrives here was typed
 * into a textarea by a person, and "%" is a character people type. A token that
 * cannot be decoded is not a file reference, and the caller renders the words
 * as they were written.
 */
export function filePath(raw: string): string | null {
  if (!raw.toLowerCase().startsWith(SCHEME)) return null;
  const encoded = raw.slice(SCHEME.length);
  if (!encoded) return null;
  // Ours are percent-encoded, so a path separator is always %2F. A RAW slash
  // means this is something else wearing the same scheme — file:///etc/passwd
  // being the one that matters — and it has to fall through to be refused as a
  // URL and stay VISIBLE. Claiming it here would resolve it against the map,
  // find nothing, and quietly render it as plain words, which hides a dead link
  // from the only person who can fix it.
  if (encoded.includes("/")) return null;
  try {
    return decodeURIComponent(encoded) || null;
  } catch {
    // A lone "%" or a truncated escape. Not a reference to anything.
    return null;
  }
}

/**
 * The same signed URL, asking the browser to save the file rather than show it.
 *
 * `download` is a plain query parameter that Supabase appends AFTER signing —
 * the token covers the path and the expiry, not the query — so adding it here
 * costs nothing and re-uses the URL the attachment list already holds, rather
 * than paying for a second round trip to mint a near-identical one.
 *
 * It has to be the server that decides this. The HTML `download` attribute is
 * ignored cross-origin, and storage is a different origin from the app, so an
 * anchor carrying only the attribute would open a PDF in a tab and look like
 * the feature is broken.
 */
export function withDownload(url: string, filename: string): string {
  // Every signed URL carries ?token=, so the separator is always "&". Guarding
  // anyway: a URL with no query at all would otherwise get a broken one.
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}download=${encodeURIComponent(filename)}`;
}
