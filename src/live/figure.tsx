"use client";

// A question's figure: an image in 0012's `activity-files` bucket, under the
// activity's own folder — the one place both the instructor and the class can
// read (live_questions.figure_path, 0047). Shown through a signed URL that is
// re-signed before it runs out, so a screen left open through a whole class
// doesn't turn into broken images.

import { useEffect, useState } from "react";
import { put, RESIGN_MS, signedUrl } from "@/checkins/storage";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
/** A cropped page figure is well under this; a phone photo of a whiteboard isn't far off. */
const MAX_FIGURE_BYTES = 8 * 1024 * 1024;

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Why this file can't be a figure, or null if it can. */
export function refuseFigure(file: Blob): string | null {
  if (!IMAGE_TYPES.has(file.type)) return "Use a PNG, JPEG or WebP image.";
  if (file.size > MAX_FIGURE_BYTES) return "That image is over 8 MB.";
  return null;
}

/** Upload one figure for a question; returns its path for figure_path. */
export async function uploadFigure(activityId: string, questionId: string, file: Blob): Promise<string> {
  const refused = refuseFigure(file);
  if (refused) throw new Error(refused);
  const tail = Math.random().toString(36).slice(2, 8);
  const path = `${activityId}/live-${questionId}-${Date.now()}-${tail}.${EXT[file.type]}`;
  const failed = await put("activity-files", path, file, file.type);
  if (failed) throw new Error(`The image didn’t upload: ${failed.message}`);
  return path;
}

/** A signed URL for the figure, or null while it loads or if it can't be read. */
export function useFigureUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!path) return;
    let live = true;
    const sign = async () => {
      const res = await signedUrl("activity-files", path);
      if (live) setUrl(res.url);
    };
    void sign();
    const timer = window.setInterval(() => void sign(), RESIGN_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [path]);
  return url;
}

export function Figure({ path, alt, className }: { path: string | null; alt: string; className?: string }) {
  const url = useFigureUrl(path);
  if (!path) return null;
  return (
    <div className={`lq-figimg${className ? ` ${className}` : ""}`}>
      {url ? <img src={url} alt={alt} /> : <span className="lq-figwait" aria-hidden="true" />}
    </div>
  );
}
