// Team resources: the whiteboard photos a team takes during a session, filed
// under the activity they came from.
//
// Storage holds the image; one table holds what it is and what the team called
// it. Paths are {course}/{activity}/{team}/{uuid}.ext — the same convention 0013
// and 0015 use, with the team in segment 3, so the storage policies authorise
// from the path alone.
//
// Needs supabase/migrations/0017_team_resources.sql.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError } from "./data";
import { put, remove, signedUrl, signedUrls } from "./storage";

const BUCKET = "resources";
const MAX_BYTES = 25 * 1024 * 1024;

export interface TeamResource {
  id: string;
  activity_id: string;
  team_id: string;
  title: string;
  path: string;
  mime: string | null;
  size_bytes: number | null;
  created_by: string | null;
  created_at: string;
}

const db = () => requireSupabase();

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

function missing(e: unknown): boolean {
  return /team_resources|0017/.test(String((e as Error)?.message ?? e));
}

export class ResourcesNotInstalledError extends Error {
  constructor() {
    super(
      "This project has no team resources table yet — run " +
        "supabase/migrations/0017_team_resources.sql in the Supabase SQL editor.",
    );
    this.name = "ResourcesNotInstalledError";
  }
}

function storageError(error: { message: string }, op: "upload" | "read" | "delete"): Error {
  const m = error.message;
  if (/bucket not found/i.test(m)) return new ResourcesNotInstalledError();
  if (/mime type|content type/i.test(m)) {
    return new Error(
      "That file isn't an image. Photos of a whiteboard work — PNG, JPEG, WebP, GIF or " +
        "a HEIC straight off a phone.",
    );
  }
  if (/maximum allowed size|payload too large|entity too large|413/i.test(m)) {
    return new Error(
      "That image is too big to upload — the limit is 25 MB. A photo taken on a phone is " +
        "usually well under it.",
    );
  }
  if (/row-level security|not authorized|unauthorized|permission|403/i.test(m)) {
    const what = op === "read" ? "open this" : op === "delete" ? "remove this" : "add to this team";
    return new Error(
      `You don't have permission to ${what}. It belongs to another team, or your sign-in ` +
        "has lapsed — reload and try again.",
    );
  }
  if (/failed to fetch|network|timeout/i.test(m)) {
    return new Error("That didn't reach the server. Check your connection and try again.");
  }
  return new Error(m);
}

/** Everything this team has filed under one activity, newest last. */
export async function listTeamResources(
  activityId: string,
  teamId: string,
): Promise<TeamResource[]> {
  try {
    return (
      (unwrap(
        await db().from("team_resources").select("*")
          .eq("activity_id", activityId).eq("team_id", teamId).order("created_at"),
      ) as TeamResource[] | null) ?? []
    );
  } catch (e) {
    if (missing(e)) throw new ResourcesNotInstalledError();
    throw e;
  }
}

/** How many this team has filed against each activity — for the folder counts. */
export async function countTeamResources(teamId: string): Promise<Map<string, number>> {
  try {
    const rows =
      (unwrap(
        await db().from("team_resources").select("activity_id").eq("team_id", teamId),
      ) as { activity_id: string }[] | null) ?? [];
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.activity_id, (counts.get(r.activity_id) ?? 0) + 1);
    return counts;
  } catch (e) {
    // The index is readable without counts; a folder simply shows none. Better
    // than an error page over a number.
    if (missing(e)) return new Map();
    throw e;
  }
}

/** The file extension to store under, from the name or the type. Always something. */
function extensionFor(file: File): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1];
  if (fromName) return fromName.toLowerCase();
  const fromType = /^image\/([a-z0-9.+-]+)$/i.exec(file.type)?.[1];
  return (fromType ?? "img").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Shrink a photo before it goes up.
 *
 * A phone camera writes 3-5 MB for a shot of a whiteboard that is completely
 * legible at 1600px on the long edge and about 400 KB. Over a term, one class,
 * that difference is gigabytes — and it is bandwidth on a room's wifi as well
 * as storage.
 *
 * Returns the ORIGINAL untouched whenever it cannot do better:
 *  - the browser cannot decode it (HEIC off an iPhone, on a browser that is not
 *    Safari) — the bucket accepts heic, so it uploads as-is rather than failing
 *  - it is already small, so re-encoding would only lose detail
 *  - the re-encode came out no smaller, which happens with line art
 *
 * Never used for anything but images. A PDF is a document and re-encoding one
 * would destroy the text layer a marker reads.
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
/** Below this, the saving is not worth a generation of loss. */
const WORTH_SHRINKING = 600 * 1024;

async function shrink(file: File): Promise<File> {
  if (file.size <= WORTH_SHRINKING) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Undecodable here — most often HEIC away from Safari. The bucket takes it.
    return file;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    // The name goes with the format. A .heic holding JPEG bytes is a file
    // nothing downstream can reason about.
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}

/** A sensible starting label: the file's own name without its extension. */
export function defaultTitle(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, "").trim();
  return base || "Whiteboard photo";
}

export async function uploadTeamResource(
  where: { courseId: string; activityId: string; teamId: string },
  file: File,
  title: string,
): Promise<TeamResource> {
  const { courseId, activityId, teamId } = where;

  if (!/^image\//i.test(file.type)) {
    throw new Error(
      `“${file.name}” isn't an image. Photos of a whiteboard work — PNG, JPEG, WebP, GIF ` +
        "or a HEIC straight off a phone.",
    );
  }
  // Checked here as well as by the bucket: a 40 MB upload that fails after the
  // whole thing has gone up the wire wastes a slow room's time.
  if (file.size > MAX_BYTES) {
    throw new Error(
      "That image is too big to upload — the limit is 25 MB. A photo taken on a phone is " +
        "usually well under it.",
    );
  }

  // Named from the ORIGINAL, before any re-encode renames it: the team called
  // it what they called it, and "board.heic" becoming "board.jpg" in the label
  // would be the compression leaking into what they see.
  const named = title.trim() || defaultTitle(file);

  const sending = await shrink(file);
  const path = `${courseId}/${activityId}/${teamId}/${crypto.randomUUID()}.${extensionFor(sending)}`;

  const failed = await put(BUCKET, path, sending, sending.type);
  if (failed) throw storageError(failed, "upload");

  const rows = await db().from("team_resources").insert({
    activity_id: activityId,
    team_id: teamId,
    title: named,
    path,
    mime: sending.type,
    size_bytes: sending.size,
  }).select();

  if (rows.error) {
    // The row is what makes the object findable; without it the image is
    // unreachable and would sit in the bucket forever.
    await remove(BUCKET, [path]);
    if (missing(rows.error)) throw new ResourcesNotInstalledError();
    throw dbError(rows.error);
  }
  return (rows.data as TeamResource[])[0];
}

/** Rename. The only field a team can change — see the guard in 0017. */
export async function renameTeamResource(id: string, title: string): Promise<void> {
  const named = title.trim();
  if (!named) throw new Error("A resource needs a name — that is how anyone finds it again.");
  const { error } = await db().from("team_resources").update({ title: named }).eq("id", id);
  if (error) throw dbError(error);
}

export async function deleteTeamResource(r: TeamResource): Promise<void> {
  // Storage first: a failed row delete leaves an orphaned object, but a failed
  // object delete after the row is gone leaves one nobody can ever find.
  const removed = await remove(BUCKET, [r.path]);
  if (removed) throw storageError(removed, "delete");

  const { error } = await db().from("team_resources").delete().eq("id", r.id);
  if (error) throw dbError(error);
}

/** A short-lived URL the browser can render. The bucket is private. */
export async function resourceUrl(path: string): Promise<string> {
  const { url, error } = await signedUrl(BUCKET, path);
  if (error) throw storageError(error, "read");
  if (!url) throw new Error("That image is missing from storage.");
  return url;
}

/** Signed URLs for a whole set at once — one round trip, not one per thumbnail. */
export async function resourceUrls(paths: string[]): Promise<Map<string, string>> {
  const { urls, error } = await signedUrls(BUCKET, paths);
  if (error) throw storageError(error, "read");
  return urls;
}
