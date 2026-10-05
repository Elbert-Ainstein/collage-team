// The last class-list import on this course, kept so it can be undone.
//
// In sessionStorage, per course: it outlives a trip to another screen and a
// reload, which is when "wait, that was the wrong file" tends to land, and it
// is gone when the tab closes — an undo offered for last week's import would be
// an undo of things nobody remembers doing. Only ids and names, the same
// things already on the page.

import { useCallback, useEffect, useState } from "react";
import type { ImportRecord } from "./importUndo";

export interface LastImport {
  record: ImportRecord;
  /** What the import came from — "roster.csv", "what you pasted". */
  source: string;
}

const key = (courseId: string) => `fv-last-import:${courseId}`;

const isList = (v: unknown): v is unknown[] => Array.isArray(v);

/** Storage is the browser's, and anything can be in it; read it as untrusted. */
export function readLastImport(raw: string | null): LastImport | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LastImport>;
    const r = v?.record as Partial<ImportRecord> | undefined;
    const t = r?.teams;
    const ok =
      typeof v?.source === "string" &&
      r && isList(r.added) && isList(r.emails) && isList(r.names) &&
      t && isList(t.moved) && isList(t.created) && isList(t.renamed);
    return ok ? (v as LastImport) : null;
  } catch {
    return null;
  }
}

export function useLastImport(courseId: string): [LastImport | null, (next: LastImport | null) => void] {
  const [value, setValue] = useState<LastImport | null>(null);

  useEffect(() => {
    try {
      setValue(readLastImport(window.sessionStorage.getItem(key(courseId))));
    } catch {
      // Storage refused (private mode): there is simply no import to undo.
      setValue(null);
    }
  }, [courseId]);

  const set = useCallback(
    (next: LastImport | null) => {
      setValue(next);
      try {
        if (next) window.sessionStorage.setItem(key(courseId), JSON.stringify(next));
        else window.sessionStorage.removeItem(key(courseId));
      } catch {
        // Not remembered across a reload; still undoable until then.
      }
    },
    [courseId],
  );

  return [value, set];
}
