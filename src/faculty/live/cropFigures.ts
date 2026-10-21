// Cutting each drafted question's figure out of the PDF it came from.
//
// The import says where a figure is — a page and a box, as fractions of the
// page — and this renders that page in the browser, crops the box (with a
// little margin, since a model's box is approximate), and uploads the crop as
// the question's image. The PDF never leaves for this: it's the File she
// dropped, still in memory.

import type { DraftFigure } from "@/assistant/liveDraft";
import { uploadFigure } from "@/live/figure";

/** Rendered this wide, a figure stays sharp on a projector. */
const PAGE_WIDTH = 1600;
/** Of the page, around the box: a model's box clips labels at its edges. */
const MARGIN = 0.015;

export interface FigureJob {
  questionId: string;
  figure: DraftFigure;
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** The crop rectangle in pixels for a box on a page this size. */
export function cropRect(box: DraftFigure["box"], width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  const x0 = clamp(box.x - MARGIN);
  const y0 = clamp(box.y - MARGIN);
  const x1 = clamp(box.x + box.w + MARGIN);
  const y1 = clamp(box.y + box.h + MARGIN);
  const w = Math.round((x1 - x0) * width);
  const h = Math.round((y1 - y0) * height);
  // A box that rounds to a sliver isn't a figure; leave the question without one.
  if (w < 24 || h < 24) return null;
  return { x: Math.round(x0 * width), y: Math.round(y0 * height), w, h };
}

/**
 * Crop and upload every figure. Returns question id → storage path for the
 * ones that worked; a figure that fails is left off (she can add an image by
 * hand) and counted in `failed`.
 */
export async function cropFigures(
  pdf: ArrayBuffer,
  activityId: string,
  jobs: FigureJob[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ paths: Map<string, string>; failed: number }> {
  const paths = new Map<string, string>();
  if (jobs.length === 0) return { paths, failed: 0 };
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  // pdfjs takes ownership of the buffer it's given; a copy keeps hers intact.
  const doc = await pdfjs.getDocument({ data: pdf.slice(0) }).promise;
  const pages = new Map<number, HTMLCanvasElement>();
  let failed = 0;
  try {
    for (const [i, job] of jobs.entries()) {
      try {
        let canvas = pages.get(job.figure.page);
        if (!canvas) {
          const page = await doc.getPage(job.figure.page);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: PAGE_WIDTH / base.width });
          canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("no canvas");
          await page.render({ canvasContext: ctx, viewport }).promise;
          pages.set(job.figure.page, canvas);
        }
        const rect = cropRect(job.figure.box, canvas.width, canvas.height);
        if (!rect) throw new Error("box too small");
        const out = document.createElement("canvas");
        out.width = rect.w;
        out.height = rect.h;
        const octx = out.getContext("2d");
        if (!octx) throw new Error("no canvas");
        octx.fillStyle = "#fff";
        octx.fillRect(0, 0, rect.w, rect.h);
        octx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("no image");
        paths.set(job.questionId, await uploadFigure(activityId, job.questionId, blob));
      } catch {
        failed++;
      }
      onProgress?.(i + 1, jobs.length);
    }
  } finally {
    await doc.destroy();
  }
  return { paths, failed };
}
