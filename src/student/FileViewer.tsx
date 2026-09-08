"use client";

// Looking at a team's file without leaving the app.
//
// Everything a browser can be made to show, this shows: a photo, a PDF, a
// spreadsheet's worth of comma-separated text, a recording, a clip. What it
// cannot show — a .docx, a .zip — it says so about, and hands over.
//
// WHY IT FETCHES RATHER THAN LINKS. The file is signed as an attachment, which
// is what stops a browser rendering an uploaded page on the Supabase project's
// own origin (see resources.ts). Nothing here undoes that: the bytes are
// fetched and drawn BY THIS APP — a PDF onto a canvas by pdf.js, text into a
// <pre> React escapes, media into an element that only ever decodes media — so
// no untrusted markup is ever handed to the browser as a document. A file that
// cannot be shown that way is not shown at all.

import { useEffect, useRef, useState } from "react";
import { SIcon } from "./icons";
import { previewable, type TeamResource } from "@/checkins/resources";
import {
  readDocx,
  readPptx,
  readXlsx,
  type OfficeDoc,
} from "./officePreview";

/** How a file can be shown, decided once. */
export type Viewable =
  | "image"
  | "pdf"
  | "text"
  | "audio"
  | "video"
  | "pptx"
  | "docx"
  | "xlsx"
  | "none";

const TEXTUAL =
  /\.(txt|csv|tsv|md|markdown|json|log|ya?ml|ini|conf|tex|bib|r|py|m|jl|c|h|cpp|java|js|ts|sql)$/i;

/**
 * What this file can be shown as.
 *
 * Extension first for the textual ones, because a .csv arrives as
 * application/vnd.ms-excel, text/csv or nothing at all depending on the machine
 * that made it, and all three are the same file to a reader.
 */
export function viewableAs(r: Pick<TeamResource, "mime" | "path">): Viewable {
  if (previewable(r.mime, r.path)) return "image";
  const mime = r.mime ?? "";
  if (/^application\/pdf$/i.test(mime) || /\.pdf$/i.test(r.path)) return "pdf";
  if (/^audio\//i.test(mime) || /\.(mp3|m4a|wav|ogg|oga|webm)$/i.test(r.path)) return "audio";
  if (/^video\//i.test(mime) || /\.(mp4|mov|m4v|webm)$/i.test(r.path)) return "video";
  if (/^text\//i.test(mime) || TEXTUAL.test(r.path)) return "text";
  // Office files, by extension: the mime a browser reports for one depends on
  // what is installed on the machine that uploaded it, and is often blank.
  if (/\.pptx$/i.test(r.path)) return "pptx";
  if (/\.docx$/i.test(r.path)) return "docx";
  if (/\.xlsx$/i.test(r.path)) return "xlsx";
  return "none";
}

/** Text is read into the page, so it is read up to a point. */
const TEXT_LIMIT = 400_000;

/** Beyond this many pages, the rest render as you scroll to them. */
const FIRST_PAGES = 3;

async function renderPdf(bytes: ArrayBuffer, into: (urls: string[]) => void): Promise<() => void> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  // From the BYTES, not from the URL: they are already here, and pdf.js
  // fetching the signed URL again would double the download of a big scan.
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const made: string[] = [];

  for (let n = 1; n <= Math.min(doc.numPages, FIRST_PAGES); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1000 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser would not give the page a canvas to draw on.");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const url = await new Promise<string>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Not rendered."))),
        "image/jpeg",
        0.82,
      );
    });
    made.push(url);
    into([...made]);
  }
  return () => made.forEach((u) => URL.revokeObjectURL(u));
}

export function FileViewer({
  file,
  url,
  onClose,
}: {
  file: TeamResource;
  /** The signed URL. Fetched here; never navigated to. */
  url: string | undefined;
  onClose: () => void;
}): JSX.Element {
  const kind = viewableAs(file);
  const [pages, setPages] = useState<string[]>([]);
  const [text, setText] = useState<string | null>(null);
  const [media, setMedia] = useState<string | null>(null);
  const [office, setOffice] = useState<OfficeDoc | null>(null);
  const [loading, setLoading] = useState(kind !== "image" && kind !== "none");
  const [problem, setProblem] = useState<string | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  // Escape closes it. A full-screen overlay whose only exit is a click strands
  // anyone not using a mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!url || kind === "image" || kind === "none") return;
    let live = true;
    setLoading(true);
    setProblem(null);

    (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`The file came back ${res.status}.`);

      if (kind === "text") {
        const whole = await res.text();
        if (!live) return;
        setText(whole.length > TEXT_LIMIT ? whole.slice(0, TEXT_LIMIT) : whole);
        return;
      }
      if (kind === "pdf") {
        const bytes = await res.arrayBuffer();
        if (!live) return;
        cleanup.current = await renderPdf(bytes, (urls) => live && setPages(urls));
        return;
      }
      if (kind === "pptx" || kind === "docx" || kind === "xlsx") {
        const bytes = await res.arrayBuffer();
        if (!live) return;
        const read = kind === "pptx" ? readPptx : kind === "docx" ? readDocx : readXlsx;
        const doc = await read(bytes);
        if (!live) {
          doc.revoke();
          return;
        }
        cleanup.current = doc.revoke;
        setOffice(doc);
        return;
      }
      // Audio and video: an object URL of the bytes, so the element decodes
      // what is already here rather than re-requesting an attachment.
      const blob = await res.blob();
      if (!live) return;
      const objectUrl = URL.createObjectURL(blob);
      cleanup.current = () => URL.revokeObjectURL(objectUrl);
      setMedia(objectUrl);
    })()
      .catch((e) => live && setProblem(String((e as Error)?.message ?? e)))
      .finally(() => live && setLoading(false));

    return () => {
      live = false;
      cleanup.current?.();
      cleanup.current = null;
    };
  }, [url, kind]);

  return (
    <div
      className="sv-tr-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={file.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sv-fv-frame" onClick={(e) => e.stopPropagation()}>
        <div className="sv-fv-bar">
          <span className="sv-ellip" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
            {file.title}
          </span>
          {/* The way out for a file nobody can render, and a second way out for
              everything else — some things are easier read in their own app. */}
          {url ? (
            <a className="sv-btn ghost sm" href={url} target="_blank" rel="noreferrer">
              Download
            </a>
          ) : null}
          <button type="button" className="sv-btn ghost sm" onClick={onClose} aria-label="Close">
            <SIcon name="close" size={16} />
          </button>
        </div>

        <div className="sv-fv-body">
          {problem ? (
            <p className="sv-fv-note">{problem}</p>
          ) : loading ? (
            <p className="sv-fv-note">Opening…</p>
          ) : kind === "image" && url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={file.title} />
          ) : kind === "pdf" ? (
            <>
              {pages.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p} src={p} alt={`Page ${i + 1}`} />
              ))}
              <p className="sv-fv-note">
                {pages.length === FIRST_PAGES
                  ? `First ${FIRST_PAGES} pages. Download it for the rest.`
                  : `${pages.length} ${pages.length === 1 ? "page" : "pages"}.`}
              </p>
            </>
          ) : kind === "text" ? (
            <pre className="sv-fv-text">{text}</pre>
          ) : office?.slides ? (
            <>
              {/* A deck, slide by slide: what is written on each one and the
                  pictures placed on it. Not a rendering — see officePreview —
                  so it says so rather than letting a marker believe they have
                  seen the file. */}
              {office.slides.map((slide, i) => (
                <div key={i} className="sv-fv-slide">
                  <div className="sv-fv-slideno">Slide {i + 1}</div>
                  {slide.lines.map((line, j) => (
                    <p key={j} className={j === 0 ? "sv-fv-slidetitle" : "sv-fv-slideline"}>
                      {line}
                    </p>
                  ))}
                  {slide.images.map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={src} src={src} alt="" className="sv-fv-slideimg" />
                  ))}
                  {!slide.lines.length && !slide.images.length ? (
                    <p className="sv-fv-note">Nothing on this slide but its layout.</p>
                  ) : null}
                </div>
              ))}
              <p className="sv-fv-note">
                {office.slides.length} {office.slides.length === 1 ? "slide" : "slides"} — the
                words and pictures, not the layout. Download it to see the deck itself.
              </p>
            </>
          ) : office?.blocks ? (
            <div className="sv-fv-doc">
              {office.blocks.map((b, i) =>
                b.kind === "table" ? (
                  <table key={i} className="sv-fv-table">
                    <tbody>
                      {b.rows?.map((row, r) => (
                        <tr key={r}>
                          {row.map((cell, c) => (
                            <td key={c}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : b.kind === "heading" ? (
                  <h3 key={i} className="sv-fv-h">
                    {b.text}
                  </h3>
                ) : (
                  <p key={i} className={b.kind === "bullet" ? "sv-fv-bullet" : "sv-fv-p"}>
                    {b.text}
                  </p>
                ),
              )}
              <p className="sv-fv-note">The text, not the formatting. Download it for that.</p>
            </div>
          ) : office?.sheets ? (
            <div className="sv-fv-doc">
              {office.sheets.map((sheet) => (
                <div key={sheet.name} style={{ width: "100%" }}>
                  <div className="sv-fv-slideno">{sheet.name}</div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="sv-fv-table">
                      <tbody>
                        {sheet.rows.map((row, r) => (
                          <tr key={r}>
                            {row.map((cell, c) => (
                              <td key={c}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!sheet.rows.length ? <p className="sv-fv-note">This sheet is empty.</p> : null}
                </div>
              ))}
              <p className="sv-fv-note">
                Values as they are stored — a formula shows its result, not the formula.
              </p>
            </div>
          ) : kind === "audio" && media ? (
            <audio controls src={media} style={{ width: "100%" }} />
          ) : kind === "video" && media ? (
            <video controls src={media} style={{ maxWidth: "100%", maxHeight: "70vh" }} />
          ) : (
            <p className="sv-fv-note">
              This kind of file can&rsquo;t be shown here — download it to open it in whatever you
              usually use.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
