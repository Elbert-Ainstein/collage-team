// Storage and data access for team audio — the recording of a discussion, which
// in this course is the artefact the activity produces.
//
// Two things hold one recording: an object in the PRIVATE `recordings` bucket
// (the bytes) and a row in `recordings` (the index — duration, author, order).
// Row-level security decides both, on the same question: may this account reach
// the check-in result the recording hangs off? See
// supabase/migrations/0013_recordings.sql. Nothing here re-checks that for
// safety; it only shapes what comes back and turns refusals into words.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError, selectAll, selectAllIn } from "./data";
import type { Recording } from "./types";

export type { Recording };

const db = () => requireSupabase();
function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

const BUCKET = "recordings";

/**
 * How long a playback URL stays valid.
 *
 * One hour, which is long enough for the case that sets the bound: a team opens
 * the activity at the start of a discussion block, plays their earlier take
 * twice, and comes back to it before the block ends — all from URLs signed on
 * that one page load. It is also short enough that a link copied out of the
 * network tab (or pasted into a group chat) stops working the same morning,
 * which matters because the bucket is private and the signature is the only
 * thing standing between the file and anyone holding the link.
 */
const SIGNED_URL_SECONDS = 60 * 60;

/**
 * The container the browser actually recorded in.
 *
 * Chrome and Firefox give webm/Opus, Safari gives mp4/AAC, and MediaRecorder
 * reports it with parameters attached ("audio/webm;codecs=opus"). The bucket's
 * allowed_mime_types is an exact-string list, so the parameters have to come off
 * or a perfectly ordinary recording is refused on upload. An unrecognised type
 * is sent as webm rather than rejected here: the server's list is the authority,
 * and being wrong about it produces a clear refusal from storage.
 */
const CONTAINERS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
};

function containerOf(blobType: string): { mime: string; ext: string } {
  const mime = blobType.split(";")[0].trim().toLowerCase();
  const ext = CONTAINERS[mime];
  return ext ? { mime, ext } : { mime: "audio/webm", ext: "webm" };
}

/** Turns a storage refusal into something the person recording can act on. */
type Op = "upload" | "play" | "delete";

function storageError(error: { message: string }, op: Op = "upload"): Error {
  const m = error.message;
  if (/bucket not found/i.test(m)) {
    return new Error(
      "This project has no recordings bucket yet — run " +
        "supabase/migrations/0013_recordings.sql in the Supabase SQL editor.",
    );
  }
  if (/mime type|content type/i.test(m)) {
    return new Error(
      "This browser recorded in a format the course doesn't accept. " +
        "Chrome, Firefox and Safari all work — try one of those.",
    );
  }
  if (/maximum allowed size|payload too large|entity too large|413/i.test(m)) {
    return new Error(
      "That recording is too big to upload — the limit is 50 MB, a few hours of " +
        "talk. Record the discussion in shorter takes.",
    );
  }
  if (/row-level security|not authorized|unauthorized|permission|403/i.test(m)) {
    // The same refusal reaches three very different moments, and telling
    // someone who cannot PLAY a recording that they may not ADD audio sends
    // them looking for a problem they do not have.
    const what =
      op === "play"
        ? "open this recording"
        : op === "delete"
          ? "delete this recording"
          : "add audio to this submission";
    return new Error(
      `You don't have permission to ${what}. It belongs to another team, or your ` +
        "sign-in has lapsed — reload and try again.",
    );
  }
  if (/failed to fetch|network|timeout/i.test(m)) {
    return new Error(
      op === "upload"
        ? "The upload didn't reach the server. Check your connection and try again — " +
          "the take is still on this page until you leave it."
        : "That didn't reach the server. Check your connection and try again.",
    );
  }
  return new Error(m);
}

/**
 * Where this result lives, because the object path carries its course and
 * activity: {course_id}/{activity_id}/{result_id}/{uuid}.{ext}. That prefix is
 * what makes a course's audio removable, listable and countable in one sweep
 * later, when nobody has the app in front of them.
 */
async function locate(resultId: string): Promise<{ courseId: string; activityId: string }> {
  const results = (unwrap(
    await db().from("check_in_results").select("check_in_id").eq("id", resultId).limit(1),
  ) as { check_in_id: string }[] ?? []);
  const checkInId = results[0]?.check_in_id;
  if (!checkInId) {
    throw new Error(
      "That submission no longer exists — someone removed it while this page was " +
        "open. Reload before recording again.",
    );
  }

  const checkIns = (unwrap(
    await db().from("check_ins").select("activity_id").eq("id", checkInId).limit(1),
  ) as { activity_id: string }[] ?? []);
  const activityId = checkIns[0]?.activity_id;
  if (!activityId) {
    throw new Error("That check-in no longer exists. Reload and try again.");
  }

  const activities = (unwrap(
    await db().from("activities").select("course_id").eq("id", activityId).limit(1),
  ) as { course_id: string }[] ?? []);
  const courseId = activities[0]?.course_id;
  if (!courseId) {
    throw new Error("That activity no longer exists. Reload and try again.");
  }

  return { courseId, activityId };
}

/**
 * A duration the column can hold. MediaRecorder timing is derived from clocks
 * that can produce NaN or Infinity for a stream that never carried a timestamp,
 * and storing "unknown" as 0 would put a plausible-looking "0:00" under a take
 * that is actually four minutes long.
 */
function durationFor(durationMs: number): number | null {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  return Math.round(durationMs);
}

/**
 * Store one take and index it. Returns the row the rest of the app lists from.
 *
 * The object goes up first: an object with no row is invisible to every screen
 * in the app, whereas a row with no object is a player that fails when a team
 * presses play, having already been told the recording was saved.
 */
export async function uploadRecording(
  resultId: string,
  blob: Blob,
  durationMs: number,
): Promise<Recording> {
  if (blob.size === 0) {
    throw new Error(
      "That recording came back empty — the microphone was muted or the tab lost " +
        "access to it partway through. Record it again.",
    );
  }

  const { courseId, activityId } = await locate(resultId);
  const { mime, ext } = containerOf(blob.type);
  const path = `${courseId}/${activityId}/${resultId}/${crypto.randomUUID()}.${ext}`;

  const uploaded = await db().storage.from(BUCKET).upload(path, blob, {
    contentType: mime,
    // A fresh uuid per take, so there is nothing to overwrite. Leaving this on
    // would make a repeated upload silently replace a take a team had already
    // listened to and counted on.
    upsert: false,
  });
  if (uploaded.error) throw storageError(uploaded.error);

  const inserted = await db().from("recordings")
    .insert({ result_id: resultId, path, duration_ms: durationFor(durationMs) })
    .select("*")
    .single();
  if (inserted.error) {
    // Best effort, and its own failure is deliberately not raised over the one
    // that matters: the caller needs to hear why the recording was not saved,
    // and an orphaned object appears on no screen and plays for nobody.
    await db().storage.from(BUCKET).remove([path]).catch(() => undefined);
    throw dbError(inserted.error);
  }

  return inserted.data as Recording;
}

/**
 * Every recording on these results, oldest first — the order a team recorded
 * them in, which is the order they mean anything in.
 *
 * Paged and chunked like the helpers in ./data.ts: PostgREST truncates at 1000
 * rows without saying so, and a long id list breaks the request line.
 */
export async function listRecordings(resultIds: string[]): Promise<Recording[]> {
  if (!resultIds.length) return [];
  const rows = await selectAllIn<Recording>(resultIds, (chunk, from, to) =>
    db().from("recordings").select("*").in("result_id", chunk)
      // Totally ordered, so no row straddles a page boundary: two takes stopped
      // in the same millisecond are still separated by id.
      .order("created_at").order("id")
      .range(from, to),
  );
  // Chunking splits the query, so the server's ordering only holds inside a
  // chunk. Callers get one list, so restore it across the whole thing.
  return rows.sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** A short-lived signed URL for playback; the bucket is private. */
export async function recordingUrl(path: string): Promise<string> {
  const res = await db().storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (res.error) throw storageError(res.error, "play");
  const url = res.data?.signedUrl;
  if (!url) {
    // Storage answering with neither a URL nor an error means the object is gone
    // while its row survives — say that, rather than hand the page an empty src
    // that fails as a mute, unexplained player.
    throw new Error(
      "That recording's audio is missing from storage. It may have been removed " +
        "outside the app — record a new take.",
    );
  }
  return url;
}

/**
 * Withdraw a recording: the audio first, then the entry.
 *
 * In that order because the bytes are the thing being taken back. If the second
 * step fails the team sees an entry that will not play, and is told exactly
 * that; the reverse order would leave audio still fetchable by anyone holding
 * its path, with nothing left in the app pointing at it to clean up.
 */
/**
 * Remove every recording belonging to an activity, audio included.
 *
 * A foreign key cascades the ROWS when an activity goes, and does nothing at
 * all to the bucket — so without this the audio would be left orphaned:
 * unreachable through the app, invisible in any listing it drives, and still
 * counted against storage. The instructor said deleting an activity should take
 * its recordings with it, so the objects have to be removed explicitly, before
 * the rows that name them disappear.
 *
 * Driven off the ROWS rather than the path prefix. The prefix is now pinned by
 * 0013, but the rows are the authority on what exists, and one of them landing
 * under an unexpected prefix should still be cleaned up.
 */
export async function deleteActivityRecordings(activityId: string): Promise<number> {
  // Paged and chunked, like every other read in this app. Bare selects are
  // capped at 1000 rows SILENTLY, and a long .in() list blows the URL — either
  // way the sweep would come back short and skip the rest with no error, which
  // is the orphan this function exists to prevent.
  const checkIns = await selectAll<{ id: string }>((from, to) =>
    db().from("check_ins").select("id").eq("activity_id", activityId).order("id").range(from, to),
  );
  if (!checkIns.length) return 0;

  const results = await selectAllIn<{ id: string }>(
    checkIns.map((c) => c.id),
    (chunk, from, to) =>
      db().from("check_in_results").select("id").in("check_in_id", chunk).order("id").range(from, to),
  );
  if (!results.length) return 0;

  const rows = await selectAllIn<{ path: string }>(
    results.map((r) => r.id),
    (chunk, from, to) =>
      db().from("recordings").select("path").in("result_id", chunk).order("id").range(from, to),
  );
  if (!rows.length) return 0;

  // storage.remove takes a list; chunk it so a term's worth of takes cannot
  // blow the request.
  const paths = rows.map((r) => r.path);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db().storage.from(BUCKET).remove(paths.slice(i, i + 100));
    // Loud, not silent: a half-deleted activity with audio still in the bucket
    // is worth stopping for, and the caller has not deleted the activity yet.
    if (error) throw storageError(error, "delete");
  }
  return paths.length;
}

export async function deleteRecording(id: string): Promise<void> {
  const rows = (unwrap(
    await db().from("recordings").select("path").eq("id", id).limit(1),
  ) as { path: string }[] ?? []);
  const path = rows[0]?.path;
  if (!path) {
    // Already gone, or never visible to this account. Either way there is
    // nothing left to remove and nothing for the caller to fix.
    return;
  }

  const removed = await db().storage.from(BUCKET).remove([path]);
  if (removed.error) throw storageError(removed.error, "delete");

  const { error } = await db().from("recordings").delete().eq("id", id);
  if (error) {
    throw new Error(
      "The audio was deleted, but its entry couldn't be removed: " +
        dbError(error).message +
        " Reload the page and delete it again.",
    );
  }
}
