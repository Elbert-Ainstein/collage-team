"use client";

// The signed URLs for one activity's attachments, in one place.
//
// Lifted out of the attachment list when the brief learned to link a phrase at
// a file: the list and the description now both need these URLs, and a second
// copy of the hook would mean two batched signing calls on every page and two
// timers re-minting the same six URLs against each other. One owner, passed
// down — the row at the bottom of the page and the phrase in the middle of it
// expire together because they are the same string.

import { useEffect, useMemo, useState } from "react";

import { RESIGN_MS } from "@/checkins/storage";
import type { FileRef } from "@/checkins/types";

import { activityFileUrls } from "./facultyData";

export interface SignedFiles {
  /** Path -> URL. A path the backend refused is absent; so is a ref with none. */
  urls: Map<string, string>;
  /** Has the first attempt come back? "Opening" is not "would not open". */
  ready: boolean;
}

export function useSignedActivityFiles(held: readonly FileRef[]): SignedFiles {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [ready, setReady] = useState(false);

  const pathKey = useMemo(
    () =>
      held
        .map((r) => r.path)
        .filter((p): p is string => Boolean(p))
        .join("\n"),
    [held],
  );

  // Keyed on the PATHS, never on `held`. onChanged refetches the whole course
  // after every write and on the way back from other screens, so activity.files
  // arrives as a fresh array carrying the identical refs; an effect keyed on
  // that identity re-signs the entire list on every one of them, forever.
  useEffect(() => {
    if (!pathKey) {
      setUrls(new Map());
      setReady(true);
      return;
    }
    let live = true;
    setReady(false);
    // Built back out of the key rather than read from the closure, so there is
    // no second answer to "which paths is this run about" that could drift from
    // the dependency. activityFileUrls reads nothing off a ref but its path.
    const refs = pathKey.split("\n").map((path) => ({ name: path, path }));
    const sign = () => {
      // One batched call for the whole list. Six serial round trips to show six
      // attachments is the load this app spent a pass getting rid of.
      activityFileUrls(refs)
        .then((next) => {
          if (live) setUrls(next);
        })
        // Silent. Every row carries its own name and says for itself that it
        // would not open; a red box over the brief says it a second time, in
        // the one place somebody is trying to read.
        .catch(() => undefined)
        .finally(() => {
          if (live) setReady(true);
        });
    };
    sign();
    const tick = window.setInterval(sign, RESIGN_MS);
    return () => {
      live = false;
      window.clearInterval(tick);
    };
  }, [pathKey]);

  return { urls, ready };
}
