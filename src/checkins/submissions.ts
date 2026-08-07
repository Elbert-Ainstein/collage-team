// Student submissions: one PDF, and which of its pages answer which question.
//
// The Gradescope shape. Storage holds the pdf; two tables hold what it is and
// what it says. Paths are {course}/{activity}/{result}/{uuid}.pdf — the same
// convention 0013 uses for audio, so the storage policies authorise from
// segment 3 and there is one answer to "whose submission is this".
//
// Needs supabase/migrations/0015_submission_pdfs.sql.

import { requireSupabase } from "@/lib/supabaseClient";
import { dbError } from "./data";
import { put, remove, signedUrl } from "./storage";

const BUCKET = "submissions";
/** Long enough to read a scan without re-fetching, short enough that a copied link dies. */
const SIGNED_URL_SECONDS = 60 * 60;

export interface SubmissionFile {
  id: string;
  result_id: string;
  path: string;
  page_count: number;
  created_by: string | null;
  created_at: string;
}

/** One page answering one question. Pages are 1-based, as printed. */
export interface SubmissionPage {
  id: string;
  result_id: string;
  question_id: string;
  page: number;
  created_at: string;
}

const db = () => requireSupabase();

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

function storageError(error: { message: string }, op: "upload" | "read" | "delete"): Error {
  const m = error.message;
  if (/bucket not found/i.test(m)) {
    return new Error(
      "This project has no submissions bucket yet — run " +
        "supabase/migrations/0015_submission_pdfs.sql in the Supabase SQL editor.",
    );
  }
  if (/mime type|content type/i.test(m)) {
    return new Error("Only a PDF can be handed in. Export or print your work to PDF first.");
  }
  if (/maximum allowed size|payload too large|entity too large|413/i.test(m)) {
    return new Error(
      "That PDF is too big to upload — the limit is 50 MB. Scanning in black and white, " +
        "or at a lower resolution, usually brings a scan well under it.",
    );
  }
  if (/row-level security|not authorized|unauthorized|permission|403/i.test(m)) {
    const what =
      op === "read" ? "open this submission" : op === "delete" ? "replace this submission" : "hand this in";
    return new Error(
      `You don't have permission to ${what}. It belongs to someone else, or your sign-in ` +
        "has lapsed — reload and try again.",
    );
  }
  if (/failed to fetch|network|timeout/i.test(m)) {
    return new Error("That didn't reach the server. Check your connection and try again.");
  }
  return new Error(m);
}

/** The pdf handed in for this submission, if there is one. */
export async function getSubmissionFile(resultId: string): Promise<SubmissionFile | null> {
  const rows =
    (unwrap(
      await db().from("submission_files").select("*").eq("result_id", resultId).limit(1),
    ) as SubmissionFile[] | null) ?? [];
  return rows[0] ?? null;
}

/**
 * Upload a pdf for this submission, replacing whatever was there.
 *
 * Replace rather than accumulate: `submission_files` is unique on result_id, and
 * two pdfs against one submission is a question nobody can answer — which is
 * the real one? The page mapping goes with it, because page 3 of the old scan
 * is not page 3 of the new one, and silently keeping it would point a marker at
 * the wrong work.
 */
export async function uploadSubmissionPdf(
  where: { courseId: string; activityId: string; resultId: string },
  file: File,
  pageCount: number,
): Promise<SubmissionFile> {
  const { courseId, activityId, resultId } = where;
  const path = `${courseId}/${activityId}/${resultId}/${crypto.randomUUID()}.pdf`;

  const uploaded = await put(BUCKET, path, file, "application/pdf");
  if (uploaded) throw storageError(uploaded, "upload");

  // Old first, so a failure here leaves the student with their previous
  // submission intact rather than nothing at all.
  try {
    await clearSubmission(resultId);
  } catch (e) {
    await remove(BUCKET, [path]);
    throw e;
  }

  const rows = await db()
    .from("submission_files")
    .insert({ result_id: resultId, path, page_count: pageCount })
    .select();
  if (rows.error) {
    // The row is what makes the object findable; without it the pdf is
    // unreachable and would sit in the bucket forever.
    await remove(BUCKET, [path]);
    throw dbError(rows.error);
  }

  // The PDF IS the hand-in. Without this the result stayed "draft" — the row
  // ensureMyResult creates just to have something to hang a file off — so a
  // student who uploaded their work and mapped every page still read
  // "Nothing submitted yet", and the instructor's list still said nobody had
  // handed in. Ordered after the row so a failed insert cannot mark work
  // submitted that is not there.
  await markSubmitted(resultId, true);

  return (rows.data as SubmissionFile[])[0];
}

/**
 * Move the result between draft and submitted as the PDF comes and goes.
 *
 * Never touches a scored row: the guard in 0008 refuses it, and re-opening
 * graded work is the instructor's call rather than a side effect of a student
 * pressing Replace.
 */
async function markSubmitted(resultId: string, submitted: boolean): Promise<void> {
  const rows = (unwrap(
    await db().from("check_in_results").select("status").eq("id", resultId).limit(1),
  ) as { status: string }[] | null) ?? [];
  const now = rows[0]?.status;
  if (!now || now === "scored" || now === "excused" || now === "discussing") return;

  const next = submitted ? "submitted" : "draft";
  if (now === next) return;

  const { error } = await db().from("check_in_results")
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq("id", resultId);
  if (error) throw dbError(error);
}

/** Remove the current pdf and its page mapping. */
export async function clearSubmission(resultId: string): Promise<void> {
  const existing = await getSubmissionFile(resultId);
  if (!existing) return;

  const removed = await remove(BUCKET, [existing.path]);
  if (removed) throw storageError(removed, "delete");

  // submission_pages cascades from the result, not from the file, so the
  // mapping has to go explicitly — page 3 of the replaced pdf is not page 3 of
  // the new one.
  const pages = await db().from("submission_pages").delete().eq("result_id", resultId);
  if (pages.error) throw dbError(pages.error);

  const { error } = await db().from("submission_files").delete().eq("id", existing.id);
  if (error) throw dbError(error);

  // Back to a draft: there is no longer anything handed in, and leaving it
  // "submitted" would tell an instructor to go and grade an empty row.
  await markSubmitted(resultId, false);
}

/** A short-lived URL the browser can render. The bucket is private. */
export async function submissionUrl(path: string): Promise<string> {
  const res = await signedUrl(BUCKET, path, SIGNED_URL_SECONDS);
  if (res.error) throw storageError(res.error, "read");
  const url = res.url;
  if (!url) throw new Error("That submission's file is missing from storage.");
  return url;
}

export async function listSubmissionPages(resultId: string): Promise<SubmissionPage[]> {
  return (
    (unwrap(
      await db().from("submission_pages").select("*").eq("result_id", resultId).order("page"),
    ) as SubmissionPage[] | null) ?? []
  );
}

/**
 * Set exactly which pages answer one question.
 *
 * Delete-then-insert for that question alone, so assigning question 2 cannot
 * disturb question 1. Not a transaction — PostgREST has none — so the window
 * between them is real; it is one question's mapping on one submission, and the
 * student is looking at the screen that would show it wrong.
 */
export async function setQuestionPages(
  resultId: string,
  questionId: string,
  pages: number[],
): Promise<void> {
  const del = await db()
    .from("submission_pages")
    .delete()
    .eq("result_id", resultId)
    .eq("question_id", questionId);
  if (del.error) throw dbError(del.error);

  const wanted = Array.from(new Set(pages)).filter((p) => Number.isInteger(p) && p > 0).sort((a, b) => a - b);
  if (!wanted.length) return;

  const { error } = await db()
    .from("submission_pages")
    .insert(wanted.map((page) => ({ result_id: resultId, question_id: questionId, page })));
  if (error) throw dbError(error);
}
