// Images attached to a grading comment (0046).
//
// A marker writes the comment and, beside it, can drop in a picture — the
// diagram drawn properly, a photo of the worked solution, a screenshot with the
// slip circled. The student sees them under the comment once the grade is
// released; the database enforces that gate, not this file.
//
// Same shape as recordings: one row per object, the object path carrying the
// result id in segment 3 so storage authorises from the path alone.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError, selectAllIn } from "./data";
import { put, remove, signedUrl, signedUrls } from "./storage";

const BUCKET = "feedback" as const;
const db = () => requireSupabase();

/** Matches 0046's file_size_limit, so the refusal comes before the upload rather than after. */
export const FEEDBACK_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

/** What 0046 lets into the bucket: images every browser can draw. */
export const FEEDBACK_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

const EXT: Record<(typeof FEEDBACK_IMAGE_TYPES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface FeedbackImage {
  id: string;
  result_id: string;
  path: string;
  mime: string | null;
  /** The file's own name, when it had one worth keeping. */
  name: string | null;
  created_by: string | null;
  created_at: string;
}

const COLUMNS = "id,result_id,path,mime,name,created_by,created_at";

/** Where a result's images live: what the path is built from. */
export interface FeedbackTarget {
  courseId: string;
  activityId: string;
  resultId: string;
}

export class FeedbackImagesNotInstalledError extends Error {
  constructor() {
    super(
      "Images on comments aren't set up on this project yet — run " +
        "supabase/migrations/0046_feedback_images.sql in the Supabase SQL editor.",
    );
    this.name = "FeedbackImagesNotInstalledError";
  }
}

function notInstalled(message: string): boolean {
  return /feedback_images|bucket not found|0046/i.test(message);
}

/**
 * Why this file cannot be attached, or null if it can. Pure, so the screen can
 * say so before anything crosses the network.
 */
export function feedbackImageProblem(file: { name: string; type: string; size: number }): string | null {
  if (!(FEEDBACK_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    if (/^image\/hei[cf]$/i.test(file.type)) {
      return `“${file.name}” is a HEIC photo, which most browsers can't show. Export it as JPEG or PNG first.`;
    }
    return `“${file.name}” isn't an image this can attach — use PNG, JPEG, WebP or GIF.`;
  }
  if (file.size > FEEDBACK_IMAGE_MAX_BYTES) {
    const mb = Math.round(file.size / (1024 * 1024));
    return `“${file.name}” is ${mb} MB, over the 25 MB limit for an image on a comment.`;
  }
  return null;
}

/**
 * The name to keep for a file. A pasted screenshot arrives as "image.png" from
 * every browser, which says nothing; it is called a screenshot instead.
 */
export function feedbackImageName(file: { name: string; type: string }): string {
  const raw = file.name.trim();
  if (!raw || /^image\.(png|jpe?g|gif|webp)$/i.test(raw)) {
    return `Screenshot.${EXT[file.type as keyof typeof EXT] ?? "png"}`;
  }
  return raw.length > 255 ? raw.slice(raw.length - 255) : raw;
}

/** What to call an image on screen: its name, or its place in the set. */
export function feedbackImageLabel(image: Pick<FeedbackImage, "name">, index: number): string {
  return image.name?.trim() || `Image ${index + 1}`;
}

/** The object path for a new image. Exported for the tests. */
export function feedbackImagePath(target: FeedbackTarget, mime: string, id: string): string {
  const ext = EXT[mime as keyof typeof EXT] ?? "img";
  return `${target.courseId}/${target.activityId}/${target.resultId}/${id}.${ext}`;
}

function storageError(message: string, op: "upload" | "read" | "delete"): Error {
  if (notInstalled(message)) return new FeedbackImagesNotInstalledError();
  if (/mime type|content type/i.test(message)) {
    return new Error("That file isn't an image this can attach — use PNG, JPEG, WebP or GIF.");
  }
  if (/maximum allowed size|payload too large|entity too large|413/i.test(message)) {
    return new Error("That image is too big — the limit is 25 MB.");
  }
  if (/row-level security|not authorized|unauthorized|permission|403/i.test(message)) {
    const what = op === "read" ? "open this image" : op === "delete" ? "remove this image" : "attach images here";
    return new Error(
      `You don't have permission to ${what}. Grading may be turned off for TFs on this course, ` +
        "or your sign-in has lapsed — reload and try again.",
    );
  }
  if (/failed to fetch|network|timeout/i.test(message)) {
    return new Error("That didn't reach the server. Check your connection and try again.");
  }
  return new Error(message);
}

/** Every image on these results, oldest first. Chunked: a section's results pass the 1000-row cap. */
export async function listFeedbackImages(resultIds: string[]): Promise<FeedbackImage[]> {
  if (!resultIds.length) return [];
  try {
    const rows = await selectAllIn<FeedbackImage>(resultIds, (chunk, from, to) =>
      db()
        .from("feedback_images")
        .select(COLUMNS)
        .in("result_id", chunk)
        .order("created_at")
        .order("id")
        .range(from, to),
    );
    return rows;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (notInstalled(message)) throw new FeedbackImagesNotInstalledError();
    throw e;
  }
}

/** Attach one image. Object first, then the row; a failed row takes its object back out. */
export async function uploadFeedbackImage(target: FeedbackTarget, file: File): Promise<FeedbackImage> {
  const problem = feedbackImageProblem(file);
  if (problem) throw new Error(problem);

  const path = feedbackImagePath(target, file.type, crypto.randomUUID());
  const failed = await put(BUCKET, path, file, file.type);
  if (failed) throw storageError(failed.message, "upload");

  const res = await db()
    .from("feedback_images")
    .insert({ result_id: target.resultId, path, mime: file.type, name: feedbackImageName(file) })
    .select(COLUMNS);

  if (res.error) {
    // Without its row the object is unreachable from the app; don't leave it behind.
    await remove(BUCKET, [path]);
    if (notInstalled(res.error.message)) throw new FeedbackImagesNotInstalledError();
    throw dbError(res.error);
  }
  return (res.data as FeedbackImage[])[0];
}

/** Remove one image. Object first: a row left behind is findable, an object left behind is not. */
export async function deleteFeedbackImage(image: Pick<FeedbackImage, "id" | "path">): Promise<void> {
  const failed = await remove(BUCKET, [image.path]);
  if (failed) throw storageError(failed.message, "delete");
  const { error } = await db().from("feedback_images").delete().eq("id", image.id);
  if (error) throw dbError(error);
}

/**
 * A link that SAVES the image under its own name rather than showing it.
 * Minted on the click: it is used once, straight away.
 */
export async function feedbackImageDownloadUrl(image: Pick<FeedbackImage, "path" | "name">): Promise<string> {
  const { url, error } = await signedUrl(BUCKET, image.path, 60, image.name?.trim() || true);
  if (error) throw storageError(error.message, "read");
  if (!url) throw new Error("That image is missing from storage.");
  return url;
}

/** Signed URLs for a set of images, in one round trip. Missing ones are simply absent. */
export async function feedbackImageUrls(paths: string[]): Promise<Map<string, string>> {
  const { urls, error } = await signedUrls(BUCKET, paths);
  if (error) throw storageError(error.message, "read");
  return urls;
}
