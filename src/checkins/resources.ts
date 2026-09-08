// The team's drive: whatever a team keeps together — the whiteboard photos it
// takes during a session, and since 0035 anything else it is working from.
//
// Two kinds of folder, and only one of them is a row. An ASSIGNMENT folder is
// made by the course: every activity has one, always, whether or not anything
// has been put in it, so a photo taken in week 3 is filed under week 3 without
// anybody deciding to file it. A folder the team MADE is a team_folders row.
// The screen shows them side by side; the model keeps them apart because one
// of them cannot be renamed, deleted, or made twice.
//
// Storage holds the file; one table holds what it is and what the team called
// it. Paths are {course}/{activity | "files"}/{team}/{uuid}.ext — the same
// convention 0013 and 0015 use, with the team in segment 3, so the storage
// policies authorise from the path alone.
//
// Needs supabase/migrations/0017_team_resources.sql and 0035_team_files.sql.

import { requireSupabase } from "@/lib/supabaseClient";
import { countAllIn, dbError } from "./data";
import { put, remove, signedUrl, signedUrls } from "./storage";

const BUCKET = "resources";
/**
 * 100 MB, matching the bucket (0022).
 *
 * Nothing is compressed on the way in, so this has to fit whatever a phone
 * actually wrote. Checked here as well as by the bucket because a rejection
 * after the whole file has crossed a room's wifi wastes the upload; this one
 * lands instantly.
 */
const MAX_BYTES = 100 * 1024 * 1024;

export interface TeamResource {
  id: string;
  /**
   * The assignment folder this file sits in, when it sits in one. Null for a
   * file in a folder of the team's own, or loose at the top level — see 0035.
   */
  activity_id: string | null;
  /** A folder the team made. Null for an assignment folder or the top level. */
  folder_id: string | null;
  team_id: string;
  title: string;
  path: string;
  mime: string | null;
  size_bytes: number | null;
  created_by: string | null;
  created_at: string;
}

/** A folder a team made for itself. Assignment folders are not rows — see below. */
export interface TeamFolder {
  id: string;
  team_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
}

const db = () => requireSupabase();

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

function missing(e: unknown): boolean {
  return /team_resources|team_folders|0017|0035/.test(String((e as Error)?.message ?? e));
}

export class ResourcesNotInstalledError extends Error {
  constructor() {
    super(
      "This project's team files are not set up yet — run " +
        "supabase/migrations/0017_team_resources.sql and then 0035_team_files.sql in the " +
        "Supabase SQL editor. 0035 is the one that adds folders; without it the drive can " +
        "read nothing, because every file it looks for is filed under a folder.",
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
      "That image is too big to upload — the limit is 100 MB. If your project is still on " +
        "the Supabase free plan the real ceiling is 50 MB, whatever this bucket says.",
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

/**
 * Everything this team holds, in one read.
 *
 * The drive shows folders side by side — the assignment ones and the team's
 * own — so it needs the whole set to count and group them. Per-activity
 * fetching was right when the screen opened one activity at a time; asking it
 * twelve times to draw one page is not.
 */
export async function listAllTeamResources(teamId: string): Promise<TeamResource[]> {
  try {
    return (
      (unwrap(
        await db().from("team_resources").select("*").eq("team_id", teamId).order("created_at"),
      ) as TeamResource[] | null) ?? []
    );
  } catch (e) {
    if (missing(e)) throw new ResourcesNotInstalledError();
    throw e;
  }
}

/** The folders this team made. Newest last, which is the order they appear in. */
export async function listTeamFolders(teamId: string): Promise<TeamFolder[]> {
  try {
    return (
      (unwrap(
        await db().from("team_folders").select("*").eq("team_id", teamId).order("created_at"),
      ) as TeamFolder[] | null) ?? []
    );
  } catch (e) {
    if (missing(e)) throw new ResourcesNotInstalledError();
    throw e;
  }
}

export async function createTeamFolder(teamId: string, name: string): Promise<TeamFolder> {
  const named = name.trim();
  if (!named) throw new Error("A folder needs a name — that is the whole of what it is.");
  const rows = await db().from("team_folders").insert({ team_id: teamId, name: named }).select();
  if (rows.error) {
    if (missing(rows.error)) throw new ResourcesNotInstalledError();
    throw dbError(rows.error);
  }
  return (rows.data as TeamFolder[])[0];
}

export async function renameTeamFolder(id: string, name: string): Promise<void> {
  const named = name.trim();
  if (!named) throw new Error("A folder needs a name — that is the whole of what it is.");
  const { error } = await db().from("team_folders").update({ name: named }).eq("id", id);
  if (error) throw dbError(error);
}

/**
 * Remove the folder. What was in it is NOT removed — 0035 sets those rows'
 * folder_id to null, so the files land at the top level of the drive.
 *
 * The alternative is one press destroying work nobody can photograph twice.
 */
export async function deleteTeamFolder(id: string): Promise<void> {
  const { error } = await db().from("team_folders").delete().eq("id", id);
  if (error) throw dbError(error);
}

/**
 * Move a file into an assignment folder, into one of the team's own, or out to
 * the top level.
 *
 * The row moves and the object does not: what a storage policy authorises on
 * is the team in the path, which is not what changes here. 0035 relaxed 0017's
 * guard for exactly this, and still pins team, path and who filed it.
 */
export async function moveTeamResource(
  id: string,
  to: { activityId?: string | null; folderId?: string | null },
): Promise<void> {
  const { error } = await db()
    .from("team_resources")
    .update({ activity_id: to.activityId ?? null, folder_id: to.folderId ?? null })
    .eq("id", id);
  if (error) throw dbError(error);
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

/**
 * How many photos these teams hold in total — what deleting them would destroy.
 *
 * Set-wide and across every activity, unlike the folder counts above, because
 * that is what the delete does: team_resources cascades from teams, so dropping
 * a team takes its photos from all twelve weeks and not just the one on screen.
 * Chunked, because a term of teams is more ids than a URL will carry.
 */
export async function countResourcesForTeams(teamIds: string[]): Promise<number> {
  if (!teamIds.length) return 0;
  try {
    return await countAllIn(teamIds, (chunk) =>
      db().from("team_resources").select("id", { count: "exact", head: true }).in("team_id", chunk),
    );
  } catch (e) {
    // No table means no photos, which is the true answer. Anything else has to
    // reach the caller: this number gates a destructive confirm, and a guess
    // there tells someone they have nothing to lose.
    if (missing(e)) return 0;
    throw e;
  }
}

/**
 * File types a browser runs as a document, which this drive will not hold.
 *
 * Storage objects are served from the Supabase project's own origin. An .html
 * page or an .svg carrying a script is therefore a page executing on that
 * origin the moment anybody opens the link — and the app hands that link to
 * every teammate and to course staff. 0017's images-only rule made this
 * impossible by accident; taking the rule off for a drive puts it back, so it
 * is refused on purpose here.
 *
 * Everything else a class actually shares is unaffected: PDFs, images, data,
 * documents, archives, and anything with no registered type at all.
 */
const EXECUTABLE_TYPE = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)$/i;
const EXECUTABLE_EXT = /\.(html?|xhtml|shtml|svgz?|mht|mhtml|xml)$/i;

function refusedForSafety(file: File): string | null {
  if (EXECUTABLE_TYPE.test(file.type) || EXECUTABLE_EXT.test(file.name)) {
    return (
      `“${file.name}” is a web page, and a web page kept here would run in the browser of ` +
      `everyone you shared it with. Put it in a PDF, or paste a link to it instead.`
    );
  }
  return null;
}

/** Can this be shown in the page rather than saved? Images, and nothing else. */
export function previewable(mime: string | null, path: string): boolean {
  if (mime) return /^image\/(png|jpe?g|webp|gif|heic|heif|avif)$/i.test(mime);
  return /\.(png|jpe?g|webp|gif|heic|heif|avif)$/i.test(path);
}

/** The file extension to store under, from the name or the type. Always something. */
function extensionFor(file: File): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1];
  if (fromName) return fromName.toLowerCase();
  const fromType = /^image\/([a-z0-9.+-]+)$/i.exec(file.type)?.[1];
  return (fromType ?? "img").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A sensible starting label: the file's own name without its extension. */
export function defaultTitle(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, "").trim();
  return base || "Whiteboard photo";
}

/** Where a file goes: an assignment folder, a folder of the team's own, or neither. */
export interface ResourceHome {
  courseId: string;
  teamId: string;
  /** The assignment folder. Null everywhere else. */
  activityId?: string | null;
  /** One of the team's own folders. Null for the top level. */
  folderId?: string | null;
}

export async function uploadTeamResource(
  where: ResourceHome,
  file: File,
  title: string,
): Promise<TeamResource> {
  const { courseId, teamId } = where;
  const activityId = where.activityId ?? null;
  const folderId = where.folderId ?? null;

  // Any kind of file, since 0035 — a drive that takes only photographs is a
  // drive nobody can put their data in — except the ones a browser executes.
  const refused = refusedForSafety(file);
  if (refused) throw new Error(refused);

  // The size cap lands here rather than after the whole thing has crossed a
  // room's wifi.
  if (file.size > MAX_BYTES) {
    throw new Error(
      `“${file.name}” is ${Math.round(file.size / (1024 * 1024))} MB, over the 100 MB limit.`,
    );
  }

  const named = title.trim() || defaultTitle(file);

  // Uploaded exactly as the camera wrote it. A photo of a whiteboard is
  // evidence a marker reads — a re-encode that saves bytes also softens the one
  // faint line somebody needed, and there is no way to get it back afterwards.
  //
  // "files" is the segment for anything not filed under an assignment. It
  // cannot collide with an activity id, which is a uuid; see 0035.
  const home = activityId ?? "files";
  const path = `${courseId}/${home}/${teamId}/${crypto.randomUUID()}.${extensionFor(file)}`;

  const failed = await put(BUCKET, path, file, file.type || "application/octet-stream");
  if (failed) throw storageError(failed, "upload");

  const rows = await db().from("team_resources").insert({
    activity_id: activityId,
    folder_id: folderId,
    team_id: teamId,
    title: named,
    path,
    mime: file.type || null,
    size_bytes: file.size,
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

/**
 * URLs for a mixed set of files: pictures signed to be SHOWN, everything else
 * signed to be SAVED.
 *
 * The second half is the security half. What a browser does with a link is
 * decided by the response, not by the file, so a link that renders is a link
 * that can run something — and these objects come off the Supabase project's
 * own origin. Uploads already refuse the types that would exploit that; this
 * makes the ones already in a bucket, or any type nobody thought of, harmless
 * as well.
 */
export async function resourceUrlsByKind(rows: TeamResource[]): Promise<Map<string, string>> {
  const show = rows.filter((r) => previewable(r.mime, r.path)).map((r) => r.path);
  const save = rows.filter((r) => !previewable(r.mime, r.path)).map((r) => r.path);
  const [shown, saved] = await Promise.all([
    show.length ? signedUrls(BUCKET, show) : Promise.resolve({ urls: new Map(), error: null }),
    save.length
      ? signedUrls(BUCKET, save, undefined, true)
      : Promise.resolve({ urls: new Map(), error: null }),
  ]);
  if (shown.error) throw storageError(shown.error, "read");
  if (saved.error) throw storageError(saved.error, "read");
  return new Map([...shown.urls, ...saved.urls]);
}
