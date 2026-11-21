// Reading a Google Doc the instructor linked in a message.
//
// Only a doc anyone with the link can view: the server asks Google for its
// export the way a signed-out browser would, with no credentials of hers or
// ours. A private doc answers with a sign-in page or a 404, and she is told to
// share it or paste it instead.
//
// The URL fetched is never the one she pasted. Only the document id is taken
// from it, checked against a strict pattern, and put into Google's export
// address here — so a message cannot point this server anywhere else. The
// export redirects once to a googleusercontent.com download host; redirects
// are followed by hand and only to Google's own hosts, so nothing reached by
// a redirect can be inside the host's network either.

import type { Turn } from "../types";

/** Markdown keeps a rubric's tables; plain text flattens them into one run of words. */
const FORMATS = ["md", "txt"] as const;
const MAX_REDIRECTS = 3;
/** Far past any rubric. A wrong link to a 300-page doc stops here. */
const MAX_BYTES = 1_000_000;
/** What reaches the prompt: a long rubric is ~25,000. */
export const MAX_DOC_CHARS = 100_000;
/**
 * How long one read may take, all formats and redirects together. Google's
 * export is usually under a second but has been seen taking over a minute.
 * A link she just sent is worth waiting for; one from earlier in the chat is
 * context for a follow-up like "make the late penalty 20", which should not
 * stall on a slow Google.
 */
export const PATIENT_MS = 45_000;
export const BRIEF_MS = 6_000;
/** A doc read for a follow-up is reused for this long. A link sent again is always read afresh. */
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 50;

const DOC_LINK = /https?:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{25,100})/g;

export type DocFetch =
  | { ok: true; id: string; text: string; truncated: boolean }
  | { ok: false; id: string; reason: "private" | "unreachable" };

export interface FetchDocOptions {
  timeoutMs: number;
  /** Take a copy read in the last few minutes rather than asking Google again. */
  cached: boolean;
}

export type FetchDoc = (id: string, opts: FetchDocOptions) => Promise<DocFetch>;

/** Every Google Doc id linked in a piece of text, first to last, each once. */
export function googleDocIds(text: string): string[] {
  return [...new Set([...text.matchAll(DOC_LINK)].map((m) => m[1]))];
}

/**
 * The doc this conversation is about: the last one linked, in this message or
 * an earlier one she wrote. Kept across turns so "use the revised scales
 * instead" still has the document to read.
 */
export function linkedDoc(message: string, history: readonly Turn[]): { id: string; inMessage: boolean } | null {
  const now = googleDocIds(message).at(-1);
  if (now) return { id: now, inMessage: true };
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "user") continue;
    const id = googleDocIds(history[i].text).at(-1);
    if (id) return { id, inMessage: false };
  }
  return null;
}

/** Google's own hosts, on the standard port, with nothing smuggled in — the only places a redirect may lead. */
export function isGoogleHost(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    !url.username &&
    !url.password &&
    (url.hostname === "docs.google.com" || url.hostname.endsWith(".googleusercontent.com"))
  );
}

async function readCapped(res: Response): Promise<{ text: string; whole: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", whole: true };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let whole = true;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_BYTES) {
      whole = false;
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(size, MAX_BYTES));
  let at = 0;
  for (const c of chunks) {
    const room = bytes.length - at;
    if (room <= 0) break;
    bytes.set(c.subarray(0, room), at);
    at += Math.min(c.byteLength, room);
  }
  return { text: new TextDecoder().decode(bytes), whole };
}

type Attempt = { ok: true; text: string; whole: boolean } | { ok: false; reason: "private" | "unreachable" };

async function exportAs(
  id: string,
  format: (typeof FORMATS)[number],
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Attempt> {
  let url = new URL(`https://docs.google.com/document/d/${id}/export?format=${format}`);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchImpl(url, { redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return { ok: false, reason: "unreachable" };
      url = new URL(next, url);
      // A sign-in page is Google saying the doc is not shared with everyone.
      if (url.hostname === "accounts.google.com") return { ok: false, reason: "private" };
      if (!isGoogleHost(url)) return { ok: false, reason: "unreachable" };
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) return { ok: false, reason: "private" };
    if (!res.ok) return { ok: false, reason: "unreachable" };
    // A doc's export is text; an HTML page here is a sign-in or error page.
    const type = res.headers.get("content-type") ?? "";
    if (!/^text\/(plain|x-markdown|markdown)/i.test(type)) return { ok: false, reason: "private" };
    const { text, whole } = await readCapped(res);
    return { ok: true, text, whole };
  }
  return { ok: false, reason: "unreachable" };
}

/**
 * Markdown first, plain text if Google will not make Markdown of it — but not
 * after a timeout or a network failure, which the second format would only
 * repeat. One time budget covers both.
 */
export function googleDocFetcher(fetchImpl: typeof fetch = fetch, now: () => number = Date.now): FetchDoc {
  // Per server instance, so a warm one answers follow-ups without asking Google.
  const cache = new Map<string, { at: number; doc: DocFetch & { ok: true } }>();
  return async (id, { timeoutMs, cached }) => {
    const hit = cache.get(id);
    if (cached && hit && now() - hit.at < CACHE_MS) return hit.doc;
    const signal = AbortSignal.timeout(timeoutMs);
    let first: Attempt | null = null;
    for (const format of FORMATS) {
      let got: Attempt;
      let thrown = false;
      try {
        got = await exportAs(id, format, fetchImpl, signal);
      } catch {
        got = { ok: false, reason: "unreachable" };
        thrown = true;
      }
      if (got.ok) {
        const text = got.text.replace(/\r\n/g, "\n").trim();
        const truncated = !got.whole || text.length > MAX_DOC_CHARS;
        const doc = { ok: true as const, id, text: text.slice(0, MAX_DOC_CHARS), truncated };
        cache.delete(id);
        cache.set(id, { at: now(), doc });
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
        return doc;
      }
      first ??= got;
      // Private is private in every format, and a timeout would only happen again.
      if (got.reason === "private" || thrown) break;
    }
    return { ok: false, id, reason: first && !first.ok ? first.reason : "unreachable" };
  };
}
