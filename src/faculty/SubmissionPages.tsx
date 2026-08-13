"use client";

// The student's handed-in PDF, opened at the pages they said answer THIS
// question.
//
// That mapping is the whole reason it is collected. A student uploads one PDF
// and marks which pages answer which question (0015); before this, grading
// showed a placeholder and the marker had to open the file separately and hunt.
// Stepping to question 3 now lands on the first page they marked for question 3.
//
// pdfjs is imported dynamically so it never reaches the server bundle, and its
// worker is served from /public rather than a CDN — the same arrangement
// PdfSubmit uses on the student side.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  getSubmissionFile,
  listSubmissionPages,
  submissionUrl,
  type SubmissionPage,
} from "@/checkins/submissions";
import { FIcon } from "./icons";

interface Loaded {
  /** Rendered pages, 1-based: images[0] is page 1. Null until that page has been rasterised. */
  images: (string | null)[];
  pageCount: number;
}

/**
 * How many students' rendered scans to keep.
 *
 * Stepping back to the student before this one is an ordinary move — a marker
 * second-guessing a mark — and it should not re-pay a download and a full
 * rasterise. But these are full-width JPEGs, a few hundred KB a page, so a
 * section of 40-page scans held forever would run the tab out of memory by the
 * end of a grading session. Four is as far back as anyone steps.
 */
const KEEP = 4;

async function openPdf(url: string): Promise<PDFDocumentProxy> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs.getDocument({ url }).promise;
}

/**
 * One page, at grading width, as an object URL.
 *
 * toBlob rather than toDataURL: toDataURL encodes the JPEG synchronously on the
 * main thread, so rendering a scan froze paint and the arrow keys with it, and
 * every one of those base64 strings then sat on the JS heap for as long as the
 * page was held. The URLs this mints are owned by the cache, which revokes them
 * on eviction and on unmount — nothing else may drop one on the floor.
 */
async function rasterise(doc: PDFDocumentProxy, n: number): Promise<string> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  // Wide enough to read handwriting; the pane scales it down to fit.
  const viewport = page.getViewport({ scale: 1100 / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser would not give the page a canvas to draw on.");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(URL.createObjectURL(blob));
        else reject(new Error("That page could not be rendered."));
      },
      "image/jpeg",
      0.82,
    );
  });
}

function revoke(entry: Loaded): void {
  for (const src of entry.images) if (src) URL.revokeObjectURL(src);
}

export function SubmissionPages({
  resultId,
  questionId,
  questionLabel,
}: {
  resultId: string;
  /** The question being marked, or null when the activity has no real questions. */
  questionId: string | null;
  questionLabel: string;
}): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pages, setPages] = useState<SubmissionPage[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "none" | "error">("loading");
  /** The signed URL, kept so the whole PDF can be opened in its own tab. */
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Which of THIS question's pages is on screen. Index into `mine`, not a page number. */
  const [at, setAt] = useState(0);
  const live = useRef(true);
  /** Bumped on every load. A load whose id is no longer the current one writes nothing. */
  const loadId = useRef(0);
  /** Rendered scans, keyed by submission file id, least recently used first. */
  const cache = useRef(new Map<string, Loaded>());
  /** Read inside load without re-running it — stepping question must not reload the PDF. */
  const marking = useRef(questionId);

  useEffect(() => {
    marking.current = questionId;
  }, [questionId]);

  useEffect(() => {
    live.current = true;
    const held = cache.current;
    return () => {
      live.current = false;
      for (const entry of held.values()) revoke(entry);
      held.clear();
    };
  }, []);

  const load = useCallback(async () => {
    // Two loads are in flight whenever the marker steps to the next student
    // before this one has finished rasterising, and both write to the same
    // state. `live` only answers "is this component still mounted" — it cannot
    // tell the stale load from the current one, and nothing remounts this
    // between students. Without a per-load token the slower load repaints its
    // images and its page map under the newer student's name, and every rubric
    // click after that lands on the wrong row.
    const id = ++loadId.current;
    const current = () => live.current && loadId.current === id;
    let ready = false;

    setState("loading");
    setMessage(null);
    try {
      const file = await getSubmissionFile(resultId);
      if (!current()) return;
      if (!file) {
        setLoaded(null);
        setState("none");
        return;
      }
      const [rows, url] = await Promise.all([
        listSubmissionPages(resultId),
        submissionUrl(file.path),
      ]);
      if (!current()) return;

      // Keyed on the file, not the result: replacing a submission writes a new
      // file row, so a re-uploaded scan misses the cache instead of showing the
      // pages of the PDF it replaced.
      const key = file.id;

      const keep = (entry: Loaded) => {
        cache.current.delete(key);
        cache.current.set(key, entry);
        for (const [old, held] of cache.current) {
          if (cache.current.size <= KEEP) break;
          if (old === key) continue;
          revoke(held);
          cache.current.delete(old);
        }
      };
      const publish = (entry: Loaded) => {
        // A fresh object every time: `images` is filled in place as pages land,
        // so React would otherwise be handed the same reference and skip it.
        setLoaded({ images: entry.images.slice(), pageCount: entry.pageCount });
        setState("ready");
        ready = true;
      };

      setPages(rows);
      setFileUrl(url);

      // The page the marker is about to be shown, rendered ahead of the rest so
      // they can start reading while the others fill in behind it.
      const wanted =
        rows
          .filter((p) => p.question_id === marking.current)
          .map((p) => p.page)
          .sort((a, b) => a - b)[0] ?? 1;

      const cached = cache.current.get(key);
      if (cached) {
        keep(cached);
        if (cached.images[wanted - 1]) publish(cached);
        if (cached.images.every((src) => src !== null)) return;
      }

      const doc = await openPdf(url);
      try {
        if (!current()) return;
        const entry = cached ?? {
          images: new Array<string | null>(doc.numPages).fill(null),
          pageCount: doc.numPages,
        };
        if (!cached) keep(entry);

        for (const n of [wanted, ...entry.images.map((_, i) => i + 1)]) {
          if (n < 1 || n > entry.pageCount || entry.images[n - 1]) continue;
          const src = await rasterise(doc, n);
          // Into the cache even when this load is stale: the page belongs to
          // this student either way, and the cache is what revokes its URL.
          entry.images[n - 1] = src;
          if (!current()) return;
          publish(entry);
        }
      } finally {
        await doc.destroy();
      }
    } catch (e) {
      if (!current()) return;
      // Failing part-way through the fill leaves the remaining pages blank
      // rather than pulling a pane the marker is already reading out from under
      // them; the whole-PDF link in the bar still works.
      if (ready) return;
      setMessage(e instanceof Error ? e.message : "That submission could not be opened.");
      setState("error");
    }
  }, [resultId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The pages this student marked for this question, in order. Stepping to a
  // new question starts at its FIRST page, which is the whole point.
  const mine = pages
    .filter((p) => p.question_id === questionId)
    .map((p) => p.page)
    .sort((a, b) => a - b);

  useEffect(() => {
    setAt(0);
  }, [questionId]);

  if (state === "loading") {
    return (
      <div className="fv-viewer">
        <div className="fv-sub" style={{ padding: 26 }}>
          Opening the submission…
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="fv-viewer">
        <div className="fv-sheet" style={{ padding: 26 }}>
          <div className="fv-eyebrow">Could not open it</div>
          <p className="fv-sub" style={{ marginTop: 8, lineHeight: 1.6, maxWidth: "56ch" }}>
            {message}
          </p>
          <button
            type="button"
            className="fv-btn outline sm"
            style={{ marginTop: 14 }}
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state === "none" || !loaded) {
    return (
      <div className="fv-viewer">
        <div className="fv-sheet" style={{ padding: 26 }}>
          <div className="fv-eyebrow">No PDF</div>
          <p className="fv-sub" style={{ marginTop: 8, lineHeight: 1.6, maxWidth: "56ch" }}>
            This student hasn&rsquo;t uploaded a file for this activity. If they wrote an answer
            instead it is on the right; otherwise there is nothing here to mark yet.
          </p>
        </div>
      </div>
    );
  }

  // Nothing mapped: show the whole PDF rather than an empty pane. A student who
  // handed in without mapping still handed work in, and refusing to show it
  // would make an unmapped submission ungradeable.
  const showing = mine.length ? mine : loaded.images.map((_, i) => i + 1);
  const unmapped = mine.length === 0;
  const page = showing[Math.min(at, showing.length - 1)] ?? 1;
  const src = loaded.images[page - 1];

  return (
    <div className="fv-viewer fv-viewerdoc">
      <div className="fv-pagebar">
        <span className="fv-eyebrow" style={{ flex: 1 }}>
          {unmapped
            ? `Nothing marked for question ${questionLabel} — showing the whole PDF`
            : `Question ${questionLabel} · ${
                showing.length === 1 ? "1 page" : `${showing.length} pages`
              }`}
        </span>
        {showing.length > 1 ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className="fv-arrow"
              disabled={at <= 0}
              aria-label="Previous page for this question"
              onClick={() => setAt((i) => Math.max(0, i - 1))}
            >
              <FIcon name="chevronLeft" size={15} />
            </button>
            <span className="fv-num" style={{ fontSize: "var(--fv-2xs)", color: "var(--fv-muted)" }}>
              {at + 1} / {showing.length}
            </span>
            <button
              type="button"
              className="fv-arrow"
              disabled={at >= showing.length - 1}
              aria-label="Next page for this question"
              onClick={() => setAt((i) => Math.min(showing.length - 1, i + 1))}
            >
              <FIcon name="chevronRight" size={15} />
            </button>
          </span>
        ) : null}
        <span className="fv-num" style={{ fontSize: "var(--fv-2xs)", color: "var(--fv-muted)" }}>
          p{page} of {loaded.pageCount}
        </span>
        {/* The whole file, for when the mapped pages are not enough — a marker
            checking whether something was answered somewhere else entirely.
            The link is signed and short-lived, like every other read here. */}
        {fileUrl ? (
          <a
            className="fv-iconbtn"
            style={{ width: 26, height: 26 }}
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open the whole PDF in a new tab"
            title="Open the whole PDF in a new tab"
          >
            <FIcon name="openInNew" size={15} />
          </a>
        ) : null}
      </div>

      <div className="fv-pagewrap">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`Page ${page} of the submission`} className="fv-page" />
        ) : (
          // Reachable only by stepping ahead of the fill, which is chasing this
          // page already — the pane opens on the first page of this question.
          <div className="fv-sub" style={{ padding: 26 }}>
            Rendering page {page}…
          </div>
        )}
      </div>
    </div>
  );
}
