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
import type { ActivityQuestion } from "@/checkins/types";
import { PdfSubmit } from "./PdfSubmit";
import { SIcon } from "./icons";

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

  return (
    <section className="sv-screen">
      <div className="sv-head">
        <button type="button" className="sv-btn link" onClick={onBack} style={{ gap: 4 }}>
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
          <span className="sv-sub">
            One PDF, then mark which pages answer which question — so whoever grades it opens
            straight to the right page.
          </span>
        </div>
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
            onChanged={onChanged}
          />
        )}
      </div>
    </section>
  );
}
