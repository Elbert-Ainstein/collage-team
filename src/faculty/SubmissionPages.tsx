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
import {
  getSubmissionFile,
  listSubmissionPages,
  submissionUrl,
  type SubmissionPage,
} from "@/checkins/submissions";
import { FIcon } from "./icons";

interface Loaded {
  /** Rendered pages, 1-based: images[0] is page 1. */
  images: string[];
  pageCount: number;
}

/** Render every page once, at grading width. Sequential: a 40-page scan at once stalls the tab. */
async function renderAll(url: string): Promise<Loaded> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const doc = await pdfjs.getDocument({ url }).promise;
  const images: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // Wide enough to read handwriting; the pane scales it down to fit.
    const viewport = page.getViewport({ scale: 1100 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL("image/jpeg", 0.82));
  }
  const pageCount = doc.numPages;
  await doc.destroy();
  return { images, pageCount };
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

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setMessage(null);
    setLoaded(null);
    try {
      const file = await getSubmissionFile(resultId);
      if (!live.current) return;
      if (!file) {
        setState("none");
        return;
      }
      const [rows, url] = await Promise.all([
        listSubmissionPages(resultId),
        submissionUrl(file.path),
      ]);
      if (!live.current) return;
      setPages(rows);
      setFileUrl(url);
      const rendered = await renderAll(url);
      if (!live.current) return;
      setLoaded(rendered);
      setState("ready");
    } catch (e) {
      if (!live.current) return;
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Page ${page} of the submission`} className="fv-page" />
      </div>
    </div>
  );
}
