"use client";

// The images on one result's comment, with signed links kept fresh.
//
// Shared by the grader (who attaches and removes) and the student (who only
// looks): one loader, one re-sign schedule, so the two screens cannot disagree
// about what is attached.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteFeedbackImage,
  feedbackImageDownloadUrl,
  feedbackImageProblem,
  feedbackImageUrls,
  FeedbackImagesNotInstalledError,
  listFeedbackImages,
  uploadFeedbackImage,
  type FeedbackImage,
  type FeedbackTarget,
} from "./feedbackImages";
import { RESIGN_MS } from "./storage";

export interface FeedbackImagesState {
  images: FeedbackImage[];
  /** path -> signed URL. A path with no entry renders as a placeholder. */
  urls: Map<string, string>;
  /** Uploads still in flight, so the screen can say so. */
  uploading: number;
  /** Set when images can't work here at all — the migration has not been run. */
  unavailable: string | null;
  loaded: boolean;
  attach: (files: File[]) => Promise<void>;
  remove: (image: FeedbackImage) => Promise<void>;
  /** Save one to the device under its own name. */
  download: (image: FeedbackImage) => Promise<void>;
}

/**
 * @param target  the result the comment is on, or null for none (nothing loads).
 *                Reading needs only the result id; attaching needs the whole
 *                target, because the object path is built from it.
 * @param enabled false skips loading entirely — a student's unreleased grade
 */
export function useFeedbackImages(
  target: FeedbackTarget | Pick<FeedbackTarget, "resultId"> | null,
  onError: (e: unknown) => void,
  enabled = true,
): FeedbackImagesState {
  const resultId = enabled ? (target?.resultId ?? null) : null;
  const [images, setImages] = useState<FeedbackImage[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [uploading, setUploading] = useState(0);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Read inside callbacks without re-subscribing every render.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const imagesRef = useRef<FeedbackImage[]>([]);
  imagesRef.current = images;
  // Which result the screen is on NOW, so an upload finishing after the grader
  // stepped to the next student does not land in the wrong list.
  const currentRef = useRef<string | null>(resultId);
  currentRef.current = resultId;

  useEffect(() => {
    setImages([]);
    setUrls(new Map());
    setLoaded(false);
    if (!resultId) return;

    let alive = true;
    let signedAt = 0;

    const sign = async (rows: FeedbackImage[]) => {
      if (!rows.length) return;
      try {
        const fresh = await feedbackImageUrls(rows.map((r) => r.path));
        if (!alive) return;
        signedAt = Date.now();
        setUrls(fresh);
      } catch (e) {
        if (alive) onErrorRef.current(e);
      }
    };

    listFeedbackImages([resultId])
      .then(async (rows) => {
        if (!alive) return;
        setImages(rows);
        setUnavailable(null);
        setLoaded(true);
        await sign(rows);
      })
      .catch((e) => {
        if (!alive) return;
        setLoaded(true);
        if (e instanceof FeedbackImagesNotInstalledError) setUnavailable(e.message);
        else onErrorRef.current(e);
      });

    const resign = () => void sign(imagesRef.current);
    const tick = window.setInterval(resign, RESIGN_MS);
    // Background tabs throttle timers; coming back is when a stale link gets clicked.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - signedAt >= RESIGN_MS) resign();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [resultId]);

  const attach = useCallback(
    async (files: File[]) => {
      if (!target || !("courseId" in target) || !resultId || !files.length) return;
      const ok = files.filter((f) => {
        const problem = feedbackImageProblem(f);
        if (problem) onErrorRef.current(new Error(problem));
        return !problem;
      });
      for (const file of ok) {
        setUploading((n) => n + 1);
        try {
          const image = await uploadFeedbackImage(target, file);
          const fresh = await feedbackImageUrls([image.path]).catch(() => new Map<string, string>());
          if (currentRef.current !== image.result_id) continue;
          setImages((prev) => [...prev, image]);
          setUrls((prev) => new Map([...prev, ...fresh]));
        } catch (e) {
          if (e instanceof FeedbackImagesNotInstalledError) setUnavailable(e.message);
          onErrorRef.current(e);
        } finally {
          setUploading((n) => n - 1);
        }
      }
    },
    [target, resultId],
  );

  const remove = useCallback(async (image: FeedbackImage) => {
    try {
      await deleteFeedbackImage(image);
      setImages((prev) => prev.filter((i) => i.id !== image.id));
    } catch (e) {
      onErrorRef.current(e);
    }
  }, []);

  const download = useCallback(async (image: FeedbackImage) => {
    try {
      // The link is signed as an attachment, so following it saves the file
      // and leaves this page where it is.
      const a = document.createElement("a");
      a.href = await feedbackImageDownloadUrl(image);
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      onErrorRef.current(e);
    }
  }, []);

  return { images, urls, uploading, unavailable, loaded, attach, remove, download };
}

/** The image files on a paste or drop, if any — screenshots arrive this way. */
export function imageFilesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((f) => f.type.startsWith("image/"));
}
