"use client";

// Handing in an individual assignment — the whole screen, not a sidebar.
//
// PdfSubmit used to render inside MyWork's 204px "Questions" column. After the
// column's padding and the card's own, that left roughly 138px of usable width
// for a page grid asking for minmax(120px, 1fr) — so a twenty-page scan came
// out as a twenty-item vertical stack of postage stamps, in a sidebar, next to
// a full-width panel of placeholder pages. This is the same component with the
// room it needs.
//
// The written box stays on My work. That is a note to the marker; this is the
// work.

import { useCallback, useEffect, useState } from "react";
import type { Assignment, Enrolment } from "@/checkins/studentData";
import { ensureMyResult, listMyQuestions } from "@/checkins/studentData";
import { getSubmissionFile, listSubmissionPages, markSubmitted } from "@/checkins/submissions";
import type { ActivityQuestion } from "@/checkins/types";
import { PdfSubmit } from "./PdfSubmit";
import { SIcon } from "./icons";

/**
 * The back control is 12px type with no padding — a 17px tall target, and the
 * only way off this screen, since nothing here is routed through history. The
 * padding buys a 45px one; the matching negative margin hands the space back,
 * so the margin box is the size it always was and the row lays out unchanged.
 */
const BACK_HIT = { padding: "14px 0", margin: "-14px 0" };

export function SubmitScreen({
  assignment,
  enrolment,
  onBack,
  onChanged,
}: {
  assignment: Assignment;
  enrolment: Enrolment;
  onBack: () => void;
  /** The list behind this screen holds the status this hand-in changes. */
  onChanged: () => void;
}): JSX.Element {
  const activity = assignment.activity;
  const checkIn = assignment.indivCheckIn;

  const [resultId, setResultId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ActivityQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Keyed on the check-in ID rather than the object: the assignment list
  // refetches on focus and on a timer, handing down a fresh object every time,
  // and depending on its identity re-ran this on every one of them.
  const checkInId = checkIn?.id ?? null;
  const studentId = enrolment.student.id;
  const activityId = activity.id;

  const load = useCallback(async () => {
    if (!checkInId) {
      setReady(true);
      return;
    }
    try {
      const [id, qs] = await Promise.all([
        ensureMyResult(checkInId, studentId),
        listMyQuestions(activityId),
      ]);
      setResultId(id);
      setQuestions(qs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open your hand-in.");
    } finally {
      setReady(true);
    }
  }, [checkInId, studentId, activityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const locked = assignment.myResult?.status === "scored";
  const handedIn = assignment.myResult?.status === "submitted"
    || assignment.myResult?.status === "needs_review";

  // Whether there is anything TO hand in, and whether every question has pages.
  // Read here rather than inside PdfSubmit because the Submit button lives out
  // here, above it, where a student looks for it.
  const [hasFile, setHasFile] = useState(false);
  const [mapped, setMapped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const readState = useCallback(async () => {
    if (!resultId) return;
    try {
      const [file, pages] = await Promise.all([
        getSubmissionFile(resultId),
        listSubmissionPages(resultId),
      ]);
      setHasFile(Boolean(file));
      setMapped(new Set(pages.map((p) => p.question_id)));
    } catch {
      // The hand-in below reports its own failures; this only decides whether
      // a button is pressable, and guessing "not yet" is the safe guess.
    }
  }, [resultId]);

  useEffect(() => {
    void readState();
  }, [readState]);

  const unmapped = questions.filter((q) => !mapped.has(q.id));

  async function hand(inNow: boolean) {
    if (!resultId) return;
    setBusy(true);
    setError(null);
    try {
      await markSubmitted(resultId, inNow);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sv-screen">
      <div className="sv-head">
        <button
          type="button"
          className="sv-btn link"
          onClick={onBack}
          style={{ ...BACK_HIT, gap: 4 }}
        >
          <SIcon name="chevronLeft" size={15} />
          {activity.title}
        </button>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            flexWrap: "wrap",
            marginTop: 8,
          }}
        >
          <h1 className="sv-h1">Hand in your work</h1>
          <span className="sv-sub" style={{ flex: 1, minWidth: 220 }}>
            One PDF, then mark which pages answer which question — so whoever grades it opens
            straight to the right page.
          </span>

          {/* Handing in is a press, not a side effect of uploading. Uploading
              used to submit by itself, so a student was "Turned in" while still
              working out which page answered question 3. */}
          {locked ? (
            <span className="sv-badge success" style={{ flex: "none" }}>
              Graded
            </span>
          ) : handedIn ? (
            <span style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
              <span className="sv-badge sky">Turned in</span>
              <button
                type="button"
                className="sv-btn outline"
                disabled={busy}
                onClick={() => void hand(false)}
                title="Take it back so you can upload different work. Nothing is deleted."
              >
                {busy ? "Working…" : "Unsubmit"}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="sv-btn primary"
              style={{ flex: "none" }}
              disabled={busy || !hasFile}
              onClick={() => void hand(true)}
              title={
                !hasFile
                  ? "Upload a PDF first"
                  : unmapped.length
                    ? `You can hand in now, but ${unmapped.length} question${
                        unmapped.length === 1 ? " has" : "s have"
                      } no pages yet.`
                    : "Hand this in"
              }
            >
              {busy ? "Submitting…" : "Submit"}
            </button>
          )}
        </div>

        {/* Said, not enforced. A student who genuinely has nothing for question
            4 must still be able to hand in what they do have — blocking that
            would cost them the whole assignment over one blank. */}
        {!handedIn && !locked && hasFile && unmapped.length ? (
          <div
            className="sv-sub"
            style={{ marginTop: 6, color: "var(--amber-700)", fontSize: "var(--text-xs)" }}
          >
            No pages yet for {unmapped.map((q) => q.label).join(", ")}. You can still submit —
            your marker will just see nothing for {unmapped.length === 1 ? "it" : "those"}.
          </div>
        ) : null}
      </div>

      <div className="sv-scroll">
        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: "8px 10px",
              border: "1px solid var(--cream-500)",
              borderRadius: 8,
              fontSize: "var(--text-xs)",
              color: "var(--amber-700)",
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        ) : null}

        {!checkIn ? (
          <div className="sv-card" style={{ marginTop: 12 }}>
            <div className="sv-eyebrow">Not open yet</div>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: "var(--text-sm)",
                color: "var(--muted-foreground)",
                lineHeight: 1.6,
              }}
            >
              Your instructor hasn&rsquo;t opened this activity for submissions. Seeing an
              activity and being able to hand work in are separate things.
            </p>
          </div>
        ) : !ready ? (
          <div className="sv-sub" style={{ marginTop: 14 }}>
            Opening your hand-in…
          </div>
        ) : (
          <PdfSubmit
            resultId={resultId}
            courseId={enrolment.course.id}
            activityId={activityId}
            questions={questions}
            locked={locked}
            onChanged={() => {
              void readState();
              onChanged();
            }}
          />
        )}
      </div>
    </section>
  );
}
