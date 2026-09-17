// Rendering a submission PDF to images in the browser.
//
// pdfjs is imported dynamically so it never reaches the server bundle, and its
// worker is served from /public rather than a CDN. Pages render sequentially:
// a 40-page scan rendered at once stalls the tab.

export interface RenderedPdf {
  /** Object URLs for each rendered page, 1-based: pages[0] is page 1. */
  pages: string[];
  pageCount: number;
}

/**
 * Render every page to a canvas `width` pixels wide.
 *
 * The hand-in grid uses 150 for postage-stamp tiles; the graded view uses
 * ~900, because there the student is READING their work next to the rubric,
 * not picking which page is which.
 */
export async function renderPdfPages(
  source: ArrayBuffer | string,
  width: number,
): Promise<RenderedPdf> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const doc = await pdfjs.getDocument(
    typeof source === "string" ? { url: source } : { data: source },
  ).promise;

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // A fixed width keeps the layout even whatever the paper size.
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(canvas.toDataURL("image/jpeg", 0.7));
  }
  await doc.destroy();
  return { pages, pageCount: doc.numPages };
}
