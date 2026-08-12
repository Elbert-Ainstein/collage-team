"use client";

// Handing in written work: upload one PDF, then say which pages answer which
// question. Gradescope's flow, and for the same reason — a marker opening
// question 4 should land on the pages that answer it rather than scrolling a
// scan looking for it.
//
// The PDF is read in the browser to get its page count and thumbnails; pdfjs is
// imported dynamically so it never reaches the server bundle, and its worker is
// served from /public rather than a CDN.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityQuestion } from "@/checkins/types";
import {
  clearSubmission,
  getSubmissionFile,
  listSubmissionPages,
  MAX_BYTES,
  setQuestionPages,
  submissionUrl,
  uploadSubmissionPdf,
  type SubmissionFile,
} from "@/checkins/submissions";
import { SIcon } from "./icons";

interface Loaded {
  /** Object URLs for each rendered page, 1-based: thumbs[0] is page 1. */
  thumbs: string[];
  pageCount: number;
}

const message = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

/** Render every page to a small canvas. Sequential: a 40-page scan at once stalls the tab. */
async function renderThumbs(source: ArrayBuffer | string): Promise<Loaded> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const doc = await pdfjs.getDocument(
    typeof source === "string" ? { url: source } : { data: source },
  ).promise;

  const thumbs: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // A fixed width keeps the grid even whatever the paper size.
    const viewport = page.getViewport({ scale: 150 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    await page.render({ canvasContext: ctx, viewport }).promise;
    thumbs.push(canvas.toDataURL("image/jpeg", 0.7));
  }
  await doc.destroy();
  return { thumbs, pageCount: doc.numPages };
}

export function PdfSubmit({
  resultId,
  courseId,
  activityId,
  questions,
  locked,
  onChanged,
}: {
  /** The result row this hands in against. Null until one exists. */
  resultId: string | null;
  courseId: string;
  activityId: string;
  questions: ActivityQuestion[];
  /** Graded work is closed — the database refuses the write either way. */
  locked: boolean;
  onChanged: () => void;
}): JSX.Element {
  const [file, setFile] = useState<SubmissionFile | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pages, setPages] = useState<Map<string, Set<number>>>(new Map());
  const [activeQ, setActiveQ] = useState<string | null>(questions[0]?.id ?? null);
  const [busy, setBusy] = useState<null | "loading" | "uploading" | "saving">(null);
  const [error, setError] = useState<string | null>(null);
  const [armedReplace, setArmedReplace] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Thumbnails are data URLs held in state; nothing to revoke, but a new
  // submission must not show the old one's pages.
  const load = useCallback(async () => {
    if (!resultId) return;
    setBusy("loading");
    setError(null);
    try {
      const existing = await getSubmissionFile(resultId);
      if (!live.current) return;
      setFile(existing);

      if (existing) {
        const rows = await listSubmissionPages(resultId);
        if (!live.current) return;
        const map = new Map<string, Set<number>>();
        for (const r of rows) {
          const set = map.get(r.question_id) ?? new Set<number>();
          set.add(r.page);
          map.set(r.question_id, set);
        }
        setPages(map);

        const url = await submissionUrl(existing.path);
        const rendered = await renderThumbs(url);
        if (!live.current) return;
        setLoaded(rendered);
      } else {
        setLoaded(null);
        setPages(new Map());
      }
    } catch (e) {
      if (live.current) setError(message(e, "Could not open your submission."));
    } finally {
      if (live.current) setBusy(null);
    }
  }, [resultId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!activeQ && questions.length) setActiveQ(questions[0].id);
  }, [questions, activeQ]);

  async function take(chosen: File | undefined) {
    if (!chosen || !resultId) return;
    if (chosen.type !== "application/pdf" && !/\.pdf$/i.test(chosen.name)) {
      setError(`“${chosen.name}” isn't a PDF. Export or print your work to PDF and try again.`);
      return;
    }
    // Refused before the bytes move. The bucket rejects it too, but only after a
    // room's worth of wifi has carried the whole scan and thrown it away.
    if (chosen.size > MAX_BYTES) {
      setError(
        `“${chosen.name}” is ${Math.round(chosen.size / (1024 * 1024))} MB, over the ` +
          `${MAX_BYTES / (1024 * 1024)} MB limit. Scanning in black and white, or at a lower ` +
          "resolution, usually brings a scan well under it.",
      );
      return;
    }
    setBusy("uploading");
    setError(null);
    try {
      // Read it before uploading: a file that will not parse is better refused
      // here than stored and found broken by whoever marks it.
      const bytes = await chosen.arrayBuffer();
      const rendered = await renderThumbs(bytes.slice(0));
      const row = await uploadSubmissionPdf(
        { courseId, activityId, resultId },
        chosen,
        rendered.pageCount,
      );
      if (!live.current) return;
      setFile(row);
      setLoaded(rendered);
      setPages(new Map());
      setArmedReplace(false);
      onChanged();
    } catch (e) {
      if (live.current) {
        setError(
          message(e, "That PDF could not be read. If it opens in a viewer, try re-exporting it."),
        );
      }
    } finally {
      if (live.current) setBusy(null);
    }
  }

  async function togglePage(page: number) {
    if (!resultId || !activeQ || locked) return;
    const set = new Set(pages.get(activeQ) ?? []);
    if (set.has(page)) set.delete(page);
    else set.add(page);

    // Optimistic: assigning pages is a rapid, repetitive action and waiting on
    // a round trip per click makes it feel broken.
    setPages((prev) => new Map(prev).set(activeQ, set));
    setBusy("saving");
    setError(null);
    try {
      await setQuestionPages(resultId, activeQ, [...set]);
      onChanged();
    } catch (e) {
      if (!live.current) return;
      setError(message(e, "That page assignment didn't save."));
      await load().catch(() => undefined);
    } finally {
      if (live.current) setBusy(null);
    }
  }

  async function replace() {
    if (!resultId) return;
    setBusy("uploading");
    setError(null);
    try {
      await clearSubmission(resultId);
      if (!live.current) return;
      setFile(null);
      setLoaded(null);
      setPages(new Map());
      setArmedReplace(false);
      onChanged();
    } catch (e) {
      if (live.current) setError(message(e, "Could not remove the current PDF."));
    } finally {
      if (live.current) setBusy(null);
    }
  }

  const assignedTo = (page: number) =>
    questions.filter((q) => pages.get(q.id)?.has(page)).map((q) => q.label);

  const unanswered = questions.filter((q) => !(pages.get(q.id)?.size ?? 0));

  if (!resultId) {
    return (
      <div className="sv-card" style={{ marginTop: 12 }}>
        <div className="sv-sub" style={{ lineHeight: 1.6 }}>
          This activity isn&rsquo;t open for submissions yet.
        </div>
      </div>
    );
  }

  // Two steps, not one screen with everything on it. Until a PDF exists there
  // is nothing to map pages to, so showing the question chips and an empty grid
  // asks the student to read past controls that cannot do anything yet.
  //
  // Returning early on `!file` also narrows it for everything below, so step two
  // can read file.page_count without re-asking whether there is a file.
  if (!file) {
    return (
      <div className="sv-card" style={{ marginTop: 12 }}>
        <div className="sv-eyebrow">Step 1 of 2 · Upload</div>

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 8,
              padding: "8px 10px",
              border: "1px solid var(--cream-500)",
              borderRadius: 8,
              fontSize: "var(--text-xs)",
              color: "var(--amber-700)",
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        ) : null}

        <input
          ref={picker}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            void take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        <button
          type="button"
          className="sv-dz"
          disabled={busy != null || locked}
          onClick={() => picker.current?.click()}
          style={{ width: "100%", marginTop: 10, font: "inherit", color: "inherit" }}
        >
          <SIcon name="attachFile" size={28} />
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-lg)",
              fontWeight: 700,
            }}
          >
            {busy === "uploading"
              ? "Reading your PDF…"
              : busy === "loading"
                ? "Checking for a submission…"
                : "Upload your work as a PDF"}
          </span>
          <span
            className="sv-sub"
            style={{ maxWidth: "48ch", textAlign: "center", lineHeight: 1.5 }}
          >
            One file for the whole assignment. Once it&rsquo;s up you&rsquo;ll mark which pages
            answer which question, so your marker opens straight to the right page.
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="sv-card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="sv-eyebrow" style={{ flex: 1 }}>
          Step 2 of 2 · Which pages answer which question
        </div>
        <span className="sv-sub" style={{ fontSize: "var(--text-2xs)" }}>
          {file.page_count} {file.page_count === 1 ? "page" : "pages"}
        </span>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            border: "1px solid var(--cream-500)",
            borderRadius: 8,
            fontSize: "var(--text-xs)",
            color: "var(--amber-700)",
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      ) : null}

      <input
        ref={picker}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        {locked ? (
          <span className="sv-sub">This has been graded, so it can no longer be changed.</span>
        ) : armedReplace ? (
          <>
            <button
              type="button"
              className="sv-btn"
              style={{ color: "var(--amber-700)" }}
              disabled={busy != null}
              onBlur={() => setArmedReplace(false)}
              onClick={() => void replace()}
            >
              Replace it and lose the page assignments?
            </button>
            <span className="sv-sub" style={{ fontSize: "var(--text-2xs)" }}>
              Page 3 of a new scan isn&rsquo;t page 3 of this one.
            </span>
          </>
        ) : (
          <button
            type="button"
            className="sv-btn outline"
            disabled={busy != null}
            onClick={() => setArmedReplace(true)}
          >
            Upload a different PDF
          </button>
        )}
      </div>

      {!questions.length ? (
        <div className="sv-sub" style={{ marginTop: 14, lineHeight: 1.55, maxWidth: "62ch" }}>
          Your instructor hasn&rsquo;t listed the questions for this activity, so there is
          nothing to map pages to yet. Your PDF is handed in.
        </div>
      ) : (
        <div className="sv-sub" style={{ marginTop: 14, lineHeight: 1.55, maxWidth: "62ch" }}>
          Pick a question on the left, then click the pages that answer it. A page can answer
          more than one, and a question can span several.
        </div>
      )}

      {/* Questions down the left, pages on the right. The chips-over-a-grid
          version put a 20-page scan under a wrapping row of question pills, so
          the question you were assigning to scrolled out of sight exactly when
          you needed it. */}
      <div className="sv-pdfsplit">
        {questions.length ? (
          <div className="sv-pdfq">
            <div className="sv-eyebrow" style={{ padding: "0 2px 8px" }}>
              Questions
            </div>
            {questions.map((q) => {
              const n = pages.get(q.id)?.size ?? 0;
              const on = activeQ === q.id;
              return (
                <button
                  key={q.id}
                  type="button"
                  className={`sv-pdfqbtn${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => setActiveQ(q.id)}
                >
                  <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>{q.label}</span>
                  <span
                    className="sv-num"
                    style={{
                      fontSize: "var(--text-2xs)",
                      color: on ? "inherit" : n ? "var(--navy-700)" : "var(--muted-foreground)",
                    }}
                  >
                    {n ? `${n}p` : "—"}
                  </span>
                </button>
              );
            })}

            {unanswered.length ? (
              <div
                className="sv-sub"
                style={{
                  marginTop: 10,
                  padding: "0 2px",
                  color: "var(--amber-700)",
                  fontSize: "var(--text-2xs)",
                  lineHeight: 1.5,
                }}
              >
                No pages yet for {unanswered.map((q) => q.label).join(", ")}. Your marker will
                see nothing for {unanswered.length === 1 ? "it" : "those"}.
              </div>
            ) : (
              <div
                className="sv-sub"
                style={{
                  marginTop: 10,
                  padding: "0 2px",
                  color: "var(--emerald-600)",
                  fontSize: "var(--text-2xs)",
                }}
              >
                Every question has pages.
              </div>
            )}
          </div>
        ) : null}

        <div className="sv-pdfpages">
          {loaded
            ? loaded.thumbs.map((src, i) => {
                const page = i + 1;
                const mine = activeQ ? (pages.get(activeQ)?.has(page) ?? false) : false;
                const labels = assignedTo(page);
                return (
                  <button
                    key={page}
                    type="button"
                    onClick={() => void togglePage(page)}
                    disabled={locked || !activeQ}
                    aria-pressed={mine}
                    aria-label={`Page ${page}${labels.length ? `, answers ${labels.join(", ")}` : ""}`}
                    style={{
                      padding: 4,
                      border: `2px solid ${mine ? "var(--navy)" : "var(--neutral-200)"}`,
                      borderRadius: 8,
                      background: mine ? "var(--cream-400)" : "var(--cream-100)",
                      cursor: locked || !activeQ ? "default" : "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt=""
                      style={{ width: "100%", display: "block", borderRadius: 4 }}
                    />
                    <span
                      className="sv-num"
                      style={{
                        fontSize: "var(--text-2xs)",
                        color: "var(--muted-foreground)",
                        display: "flex",
                        gap: 4,
                        justifyContent: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span>p{page}</span>
                      {labels.length ? (
                        <span style={{ color: "var(--navy)", fontWeight: 600 }}>
                          {labels.join(" ")}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            : busy === "loading"
              ? [0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    style={{ height: 150, borderRadius: 8, background: "var(--neutral-100)" }}
                  />
                ))
              : null}
        </div>
      </div>
    </div>
  );
}
