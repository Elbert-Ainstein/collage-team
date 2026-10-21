// Importing a PDF of questions from the browser.
//
// Two steps, because the PDF does not fit in a request to the route (the host
// caps bodies near 4.5 MB): upload it to the private "imports" bucket under
// this course and activity, then ask /api/live-import to draft from that path.
// The instructor's own Supabase session goes with both — the bucket's policies
// and the route each check that the course is hers.
//
// What comes back is a DRAFT (src/assistant/liveDraft.ts). Nothing is saved;
// the builder shows it and she saves what she keeps.

import { MAX_IMPORT_BYTES, importPath, type LiveDraft, type LiveImportResponse } from "@/assistant/liveDraft";
import { put } from "@/checkins/storage";
import { requireSupabase } from "@/lib/supabaseClient";

const MB = Math.round(MAX_IMPORT_BYTES / (1024 * 1024));

/** A PDF by its type, or by its name when the browser did not say (some do not). */
function isPdf(file: File): boolean {
  return file.type === "application/pdf" || (!file.type && /\.pdf$/i.test(file.name));
}

export async function importLivePdf(
  opts: { courseId: string; activityId: string; file: File },
  signal?: AbortSignal,
): Promise<LiveDraft> {
  const { courseId, activityId, file } = opts;
  // Refused here, before the upload, so a wrong file costs nothing.
  if (!isPdf(file)) throw new Error("That file is not a PDF.");
  if (file.size > MAX_IMPORT_BYTES) throw new Error(`That PDF is over ${MB} MB. Split it and import each part.`);

  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your sign-in has expired. Reload the page and sign in again.");

  const path = importPath(courseId, activityId, file.name, Date.now());
  const failure = await put("imports", path, file, "application/pdf");
  if (failure) throw new Error(`The PDF could not be uploaded: ${failure.message}`);

  let res: Response;
  try {
    res = await fetch("/api/live-import", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ courseId, activityId, path }),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new Error("The import could not be reached. Check your connection and try again.");
  }

  let body: LiveImportResponse | null = null;
  try {
    body = (await res.json()) as LiveImportResponse;
  } catch {
    // A host timeout or crash page is HTML, not the route's JSON.
  }
  if (!body) {
    throw new Error(
      res.status === 504
        ? "Reading that PDF took too long. Try a shorter one, or split it."
        : "The import sent back something unreadable. Try again.",
    );
  }
  if (!body.ok) throw new Error(body.error);
  return body.draft;
}
