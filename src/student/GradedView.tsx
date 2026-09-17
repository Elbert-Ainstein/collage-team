"use client";

// The graded submission, read the way Gradescope shows one: the student's own
// pages on the left, big enough to read, and the rubric down the right — every
// question's score, and, opened, its whole ladder with the rung the marker
// picked. Pressing a question jumps to the pages the student filed under it,
// when the hand-in mapped any.
//
// This replaces the hand-in screen once a result is RELEASED: the work is
// locked then anyway, and what the student comes back for is not the upload
// flow but "what did I get, and why, next to what I wrote".

import { useEffect, useRef, useState } from "react";
import type { Assignment, Enrolment } from "@/checkins/studentData";
import { listMyMarks, listMyQuestions, listMyRubric } from "@/checkins/studentData";
import { getSubmissionFile, listSubmissionPages, submissionUrl } from "@/checkins/submissions";
import type { RubricItem, SubmissionMark } from "@/checkins/types";
import type { PointedQuestion } from "@/faculty/model";
import { gradedQuestions, type GradedQuestion } from "./gradedRubric";
import { renderPdfPages } from "./pdfPages";
import { SIcon } from "./icons";

const BACK_HIT = { padding: "14px 0", margin: "-14px 0" };

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function GradedView({
  assignment,
  onBack,
}: {
  assignment: Assignment;
  /** Unused today; kept so the caller reads the same as SubmitScreen's. */
  enrolment?: Enrolment;
  onBack: () => void;
}): JSX.Element {
  const activity = assignment.activity;
  const result = assignment.myResult;
  const resultId = result?.id ?? null;

  const [pages, setPages] = useState<string[] | null>(null);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [rubric, setRubric] = useState<{
    questions: PointedQuestion[];
    items: RubricItem[];
    marks: SubmissionMark[];
    /** question id -> 1-based pages the student filed under it. */
    pagesFor: Map<string, number[]>;
  }>({ questions: [], items: [], marks: [], pagesFor: new Map() });

  useEffect(() => {
    if (!resultId) return;
    let alive = true;
    Promise.all([
      listMyQuestions(activity.id),
      listMyRubric(activity.id),
      listMyMarks(resultId),
      listSubmissionPages(resultId).catch(() => []),
    ])
      .then(([questions, items, marks, pageRows]) => {
        if (!alive) return;
        const pagesFor = new Map<string, number[]>();
        for (const r of pageRows) {
          pagesFor.set(r.question_id, [...(pagesFor.get(r.question_id) ?? []), r.page].sort((a, b) => a - b));
        }
        setRubric({ questions: questions as PointedQuestion[], items, marks, pagesFor });
      })
      // The pages still show without the rubric: the grade on the way in
      // already told the student the number, and a database without 0039
      // simply has no breakdown to offer yet.
      .catch(() => undefined);

    getSubmissionFile(resultId)
      .then(async (file) => {
        if (!file) {
          if (alive) setPagesError("No PDF was handed in for this one.");
          return;
        }
        const url = await submissionUrl(file.path);
        const rendered = await renderPdfPages(url, 900);
        if (alive) setPages(rendered.pages);
      })
      .catch(() => {
        if (alive) setPagesError("Your submission could not be opened. Reload to try again.");
      });

    return () => {
      alive = false;
    };
  }, [resultId, activity.id]);

  const graded = gradedQuestions(activity, rubric.questions, rubric.items, rubric.marks);

  return (
    <GradedWork
      title={activity.title}
      grade={assignment.grade}
      feedback={result?.status === "scored" ? (result.feedback?.trim() ?? null) : null}
      questions={graded}
      pages={pages}
      pagesError={pagesError}
      pagesFor={rubric.pagesFor}
      onBack={onBack}
    />
  );
}

/**
 * The layout alone, data in props — separable so it can be rendered and
 * screenshotted without a signed-in session behind it.
 */
export function GradedWork({
  title,
  grade,
  feedback,
  questions,
  pages,
  pagesError,
  pagesFor,
  onBack,
}: {
  title: string;
  grade: string;
  feedback: string | null;
  questions: GradedQuestion[];
  /** Rendered page images, or null while they render. */
  pages: string[] | null;
  pagesError: string | null;
  pagesFor: Map<string, number[]>;
  onBack: () => void;
}): JSX.Element {
  // One question's ladder open at a time, like Gradescope: all of them open
  // is a wall, and the closed rows still carry the score. The first question
  // starts open so the view lands showing what a ladder IS; null means the
  // student has not chosen yet, and "none" that they closed the open one.
  const [openQ, setOpenQ] = useState<string | null>(null);
  const shownQ = openQ ?? questions[0]?.key ?? null;
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const jumpTo = (q: GradedQuestion) => {
    setOpenQ(shownQ === q.key ? "none" : q.key);
    const first = pagesFor.get(q.key)?.[0];
    if (first) {
      // Optional-called: jsdom has no scrollIntoView, and a missed jump is
      // not worth a crash anywhere else either.
      pageRefs.current.get(first)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  };

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
          {title}
        </button>
        <div
          style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 8 }}
        >
          <h1 className="sv-h1">Your graded work</h1>
          <span className="sv-sub" style={{ flex: 1, minWidth: 220 }}>
            Your submission beside how it was marked. Press a question to see its rubric — and
            the pages you filed under it, when you marked any.
          </span>
          <span className="sv-badge success" style={{ flex: "none" }}>
            Graded
          </span>
        </div>
      </div>

      <div className="sv-scroll">
        <div className="sv-gsplit">
          <div className="sv-gpages">
            {pagesError ? (
              <div className="sv-card">
                <div className="sv-sub" style={{ lineHeight: 1.6 }}>
                  {pagesError}
                </div>
              </div>
            ) : pages ? (
              pages.map((src, i) => (
                <div
                  key={i}
                  className="sv-gpage"
                  ref={(el) => {
                    if (el) pageRefs.current.set(i + 1, el);
                    else pageRefs.current.delete(i + 1);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Page ${i + 1} of your submission`} />
                  <span className="sv-num sv-gpagenum">p{i + 1}</span>
                </div>
              ))
            ) : (
              <div className="sv-card">
                <div className="sv-sub">Opening your submission…</div>
              </div>
            )}
          </div>

          <aside className="sv-gside" aria-label="How it was graded">
            <div className="sv-card" style={{ padding: "14px 16px" }}>
              <div className="sv-eyebrow">Total</div>
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-xl)",
                  fontWeight: "var(--weight-bold)",
                  marginTop: 4,
                }}
              >
                {grade}
              </div>
              {feedback ? (
                <p
                  style={{
                    margin: "10px 0 0",
                    fontSize: "var(--text-xs)",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {feedback}
                </p>
              ) : null}
            </div>

            {questions.map((q) => {
              const open = shownQ === q.key;
              const mapped = pagesFor.get(q.key) ?? [];
              return (
                <div key={q.key} className="sv-card sv-gq">
                  <button
                    type="button"
                    className="sv-gqbtn"
                    aria-expanded={open}
                    onClick={() => jumpTo(q)}
                  >
                    <span className="sv-gqlabel">{q.label}</span>
                    <span className="sv-num sv-gqpts">
                      {q.worth != null && q.award != null
                        ? `${fmt(q.award)} / ${fmt(q.worth)}`
                        : q.deduction > 0
                          ? `−${fmt(q.deduction)}`
                          : "✓"}
                    </span>
                    <span className={`sv-gqchev${open ? " open" : ""}`} aria-hidden="true">
                      <SIcon name="chevronLeft" size={14} />
                    </span>
                  </button>

                  {open ? (
                    <div className="sv-gladder">
                      {q.ladder.map((r) => (
                        <div key={r.item.id} className={`sv-grung${r.picked ? " picked" : ""}`}>
                          <span className="sv-grungmark" aria-hidden="true">
                            {r.picked ? "✓" : ""}
                          </span>
                          <span className="sv-num sv-grungpts">+{fmt(r.award)}</span>
                          <span className="sv-grungtext">{r.item.description}</span>
                        </div>
                      ))}
                      {!q.picked ? (
                        <div
                          className="sv-sub"
                          style={{ padding: "6px 2px 2px", fontSize: "var(--text-2xs)" }}
                        >
                          Nothing was taken off this question — full marks.
                        </div>
                      ) : null}
                      {mapped.length ? (
                        <div
                          className="sv-sub"
                          style={{ padding: "6px 2px 0", fontSize: "var(--text-2xs)" }}
                        >
                          Your pages: {mapped.map((p) => `p${p}`).join(", ")}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {questions.length === 0 ? (
              <div className="sv-card">
                <div className="sv-sub" style={{ lineHeight: 1.6, fontSize: "var(--text-xs)" }}>
                  No question-by-question breakdown was recorded for this one — the total above
                  is the whole grade.
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </section>
  );
}
