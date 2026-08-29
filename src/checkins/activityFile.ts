"use client";

// The document attached to an activity — the handout, the problem set, the
// dataset — and the one way to open it.
//
// WHY THIS FILE EXISTS AT ALL. The bytes have been uploadable since 0012, but
// only from the rubric builder, where the file is framed as "the document the
// criteria are written against". That framing was never the whole truth: the
// thing an instructor attaches there IS the assignment, and until now the class
// could not open it. The write path is still faculty's (facultyData.ts owns
// uploading and removing, because only an owner may). READING is everybody's,
// so it lives here rather than in a faculty module a student screen would have
// to reach into.
//
// ONE DOCUMENT PER ACTIVITY, and that is deliberate rather than pending. It is
// stored in activities.files, an array, so a second is a schema-free change
// when somebody wants one — but a single slot is what makes attaching in the
// description and attaching in the rubric builder the SAME act. Two slots would
// mean an instructor could attach a handout in one place, not see it in the
// other, and reasonably conclude the upload failed.
//
// The bucket is private and the policies in 0012 decide who may mint a link:
// the owner always, a TF always, a student once the activity has opened. So a
// hidden activity's document is not readable by the class even if its path
// leaks — the check is the same opens_at rule the activity row itself carries.

import { useEffect, useState } from "react";
import type { Activity, FileRef } from "./types";
import { SIGNED_SECONDS, signedUrl } from "./storage";

/**
 * Objects are named `<activity_id>/<file>` and every policy on this bucket
 * reads that first segment, so the path shape is load-bearing: an object stored
 * under any other name is reachable by nobody.
 */
export const ACTIVITY_FILE_BUCKET = "activity-files" as const;

/** The activity's document, or null. One slot — see the note at the top. */
export function activityFileOf(activity: Pick<Activity, "files">): FileRef | null {
  return activity.files?.[0] ?? null;
}

/**
 * A URL the browser can open the document from.
 *
 * Signed and short-lived, because the bucket is private: the policies decide
 * who may mint one, and the link itself expires rather than becoming a way
 * around them. Null when the row predates 0012 and carries only a file NAME —
 * those can be listed and not opened, which is why the caller is handed null
 * rather than a broken link.
 */
export async function activityFileUrl(ref: FileRef | null | undefined): Promise<string | null> {
  if (!ref?.path) return null;
  const { url, error } = await signedUrl(ACTIVITY_FILE_BUCKET, ref.path, SIGNED_SECONDS);
  if (error) throw new Error(`That file could not be opened: ${error.message}`);
  return url;
}

/** What the hook below knows about the link it is fetching. */
export interface ActivityFileLink {
  /** Null while it is still being minted, and when there is nothing to mint one for. */
  url: string | null;
  loading: boolean;
  /** A sentence to show in place of the link. Never thrown — see below. */
  error: string | null;
}

/**
 * The signed link for an activity's document, refreshed whenever the file
 * changes.
 *
 * Keyed on the PATH rather than the ref object: the activity is re-fetched on
 * every refresh and arrives as a new object each time, so keying on identity
 * would mint a new URL on every unrelated change to the course.
 *
 * A failure comes back as a sentence rather than being thrown or handed to an
 * error toast. Both surfaces render this beside an activity's description,
 * which is the thing the reader actually came for — a link that cannot be
 * minted must say so where the link would have been, and leave the rest of the
 * screen alone.
 */
export function useActivityFileUrl(ref: FileRef | null | undefined): ActivityFileLink {
  const path = ref?.path ?? null;
  const [state, setState] = useState<ActivityFileLink>({ url: null, loading: false, error: null });

  useEffect(() => {
    if (!path) {
      setState({ url: null, loading: false, error: null });
      return;
    }
    let live = true;
    setState({ url: null, loading: true, error: null });
    activityFileUrl({ name: "", path })
      .then((url) => {
        if (live) setState({ url, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!live) return;
        setState({
          url: null,
          loading: false,
          error: e instanceof Error ? e.message : "That file could not be opened.",
        });
      });
    return () => {
      live = false;
    };
  }, [path]);

  return state;
}
