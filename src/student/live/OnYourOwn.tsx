"use client";

// Before class: the brief, then each question on its own, then a review list.
// Every answer saves as it's given (useAnswerSaver).

import { useState } from "react";
import { BriefText } from "@/checkins/BriefText";
import type { TeamWithMembers } from "@/checkins/types";
import { canonicalAnswer, normalizeNumber, optionLetter } from "@/live/answers";
import { Figure } from "@/live/figure";
import type { LiveModel } from "@/live/model";
import type { LiveQuestion } from "@/live/types";
import { Av, Ic, Pick } from "@/live/ui";
import type { AnswerSaver } from "./useAnswerSaver";

export function Brief({
  m,
  team,
  title,
  brief,
  due,
  answered,
  onStart,
}: {
  m: LiveModel;
  team: TeamWithMembers | null;
  title: string;
  /** The instructor's description, if there is one. */
  brief: string;
  due: string | null;
  answered: (q: number) => boolean;
  onStart: (q: number) => void;
}) {
  const N = m.questions.length;
  const done = m.questions.filter((_, i) => answered(i)).length;
  const firstOpen = m.questions.findIndex((_, i) => !answered(i));
  const label = done === 0 ? "Start" : done < N ? `Continue — question ${firstOpen + 1}` : "Review my answers";
  return (
    <div className="lq-sscroll">
      <span className="lq-sbadge lavender">Live questions</span>
      <h1 className="lq-sh1">{title}</h1>
      <p className="fv-sub" style={{ margin: "2px 0 18px" }}>
        {N} question{N === 1 ? "" : "s"}
        {due ? ` · due ${due}` : ""}
      </p>
      {brief ? (
        <p className="lq-sdesc">
          <BriefText text={brief} />
        </p>
      ) : null}

      <div className="lq-scard lq-how">
        <div className="lq-howrow">
          <span className="lq-bstep">1</span>
          <b>On your own, before class</b>
          <span className="lq-mini">
            {m.questions.map((q, i) => (
              <i key={q.id} className={answered(i) ? "on" : ""} />
            ))}
          </span>
        </div>
        <div className="lq-howrow">
          <span className="lq-bstep team">2</span>
          <b>{team ? `With ${team.name}, in class` : "With your team, in class"}</b>
          {team ? (
            <span className="lq-stack">
              {team.members.map((s) => (
                <Av key={s.id} p={s} size={22} />
              ))}
            </span>
          ) : null}
        </div>
      </div>

      <button type="button" className="fv-btn primary lq-startbtn" disabled={N === 0} onClick={() => onStart(firstOpen === -1 ? N : firstOpen)}>
        {label} <Ic name="arrowRight" size={16} />
      </button>
    </div>
  );
}

function Pips({ n, current, filled, onPick }: { n: number; current: number; filled: (q: number) => boolean; onPick: (q: number) => void }) {
  return (
    <div className="lq-spips">
      {Array.from({ length: n }, (_, i) => (
        <button
          key={i}
          type="button"
          className={`lq-spip${filled(i) ? " filled" : ""}${i === current ? " now" : ""}`}
          onClick={() => onPick(i)}
          aria-label={`Question ${i + 1}`}
          aria-current={i === current}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}

// Submit, on this device. Answers save as they're given, so what the
// instructor sees doesn't depend on it — "submitted" there is "answered every
// question". This is the student's own "I'm done", kept so the review screen
// still says so when they come back.
const submittedKey = (activityId: string) => `lq-submitted-${activityId}`;
function readSubmitted(activityId: string): boolean {
  try {
    return window.localStorage.getItem(submittedKey(activityId)) === "1";
  } catch {
    return false;
  }
}
function writeSubmitted(activityId: string): void {
  try {
    window.localStorage.setItem(submittedKey(activityId), "1");
  } catch {
    // Private mode: Submitted shows until they leave, which is all it promises.
  }
}

const listQs = (ns: number[]): string => {
  const qs = ns.map((n) => `Q${n}`);
  return qs.length < 2 ? qs[0] : `${qs.slice(0, -1).join(", ")} and ${qs[qs.length - 1]}`;
};

export function OnYourOwn({
  m,
  saver,
  cursor,
  onCursor,
  activityId,
}: {
  m: LiveModel;
  saver: AnswerSaver;
  cursor: number;
  onCursor: (q: number) => void;
  activityId: string;
}) {
  const [submittedHere, setSubmitted] = useState(() => readSubmitted(activityId));
  // Submitted: the page that says so, until they ask to see their answers.
  const [reviewing, setReviewing] = useState(false);
  const N = m.questions.length;
  const answerOf = (i: number) => saver.answers[m.questions[i]?.id] ?? null;
  const filled = (i: number) => answerOf(i) !== null;

  if (cursor >= N) {
    const done = m.questions.filter((_, i) => filled(i)).length;
    const missing = m.questions.flatMap((_, i) => (filled(i) ? [] : [i + 1]));
    const saving = m.questions.some((q) => saver.state[q.id]?.kind === "saving");
    const failed = m.questions.flatMap((q, i) => (saver.state[q.id]?.kind === "failed" ? [i + 1] : []));
    const submitted = submittedHere && missing.length === 0;
    if (submitted && !reviewing) {
      return (
        <Submitted
          answered={done}
          of={N}
          onReview={() => setReviewing(true)}
          onBack={() => onCursor(N - 1)}
        />
      );
    }
    return (
      <>
      <div className="lq-sscroll">
        <Pips n={N} current={-1} filled={filled} onPick={onCursor} />
        <div className="lq-scard">
          <h2 className="lq-h2">{submitted ? "Submitted" : done === N ? "Ready to submit" : `${done} of ${N} answered`}</h2>
          {submitted ? (
            <p className="fv-sub" style={{ margin: "0 0 10px" }}>
              You can still change an answer until class starts.
            </p>
          ) : null}
          <div className="lq-reviewlist">
            {m.questions.map((q, i) => (
              <button key={q.id} type="button" className="lq-reviewrow" onClick={() => onCursor(i)}>
                <span className="lq-qn">Q{i + 1}</span>
                <span className="lq-qshort">{q.stem}</span>
                <Pick value={answerOf(i)} size="sm" />
              </button>
            ))}
          </div>
        </div>
      </div>
      <footer className="lq-sfoot">
        <button type="button" className="fv-btn outline" onClick={() => onCursor(N - 1)}>
          <Ic name="chevronLeft" size={15} /> Back
        </button>
        <span className={`lq-saved${failed.length ? " bad" : ""}`} role="status">
          {failed.length
            ? `${listQs(failed)} didn’t save — open ${failed.length === 1 ? "it" : "them"} to try again`
            : missing.length
              ? `Answer ${listQs(missing)} to submit`
              : saving
                ? "Saving…"
                : submitted
                  ? "Answers saved"
                  : ""}
        </span>
        {submitted ? (
          <span className="lq-submitted">
            <Ic name="check" size={15} /> Submitted
          </span>
        ) : (
          <button
            type="button"
            className="fv-btn primary"
            disabled={missing.length > 0 || saving || failed.length > 0}
            onClick={() => {
              writeSubmitted(activityId);
              setSubmitted(true);
            }}
          >
            Submit
          </button>
        )}
      </footer>
      </>
    );
  }

  const question = m.questions[cursor];
  const mine = answerOf(cursor);
  const st = saver.state[question.id];
  return (
    <>
      <div className="lq-sscroll">
        <Pips n={N} current={cursor} filled={filled} onPick={onCursor} />
        <div className="fv-eyebrow lq-sq">
          Question {cursor + 1} of {N}
        </div>
        <p className="lq-sstem">{question.stem}</p>
        <Figure path={question.figure_path} alt={`Figure for question ${cursor + 1}`} className="lq-sfig" />
        {question.kind === "mc" ? (
          <div className="lq-choices" role="radiogroup" aria-label={`Question ${cursor + 1}`}>
            {question.options.map((text, i) => {
              const l = optionLetter(i);
              return (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={mine === l}
                  className={`lq-choice${mine === l ? " on" : ""}`}
                  onClick={() => saver.save(question.id, l)}
                >
                  <span className="lq-choicel">{l}</span>
                  <span className="lq-choicet">{text}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <TypedEntry key={question.id} q={question} value={mine} onChange={(v) => saver.save(question.id, v, true)} />
        )}
      </div>
      <footer className="lq-sfoot">
        <button type="button" className="fv-btn outline" disabled={cursor === 0} onClick={() => onCursor(cursor - 1)}>
          <Ic name="chevronLeft" size={15} /> Back
        </button>
        <span className={`lq-saved${st?.kind === "failed" ? " bad" : ""}`} role="status">
          {st?.kind === "saving" ? "Saving…" : st?.kind === "failed" ? st.message : mine ? "Saved" : ""}
        </span>
        <button type="button" className="fv-btn primary" onClick={() => onCursor(cursor + 1)}>
          {cursor === N - 1 ? "Review and submit" : "Next"} <Ic name="chevronRight" size={15} />
        </button>
      </footer>
    </>
  );
}

/** The end of before class: they're done, and can still look or change. */
function Submitted({ answered, of, onReview, onBack }: { answered: number; of: number; onReview: () => void; onBack: () => void }) {
  return (
    <>
      <div className="lq-sscroll lq-center">
        <div className="lq-scard lq-intro lq-donecard">
          <span className="lq-introicon lq-doneicon">
            <Ic name="check" size={26} />
          </span>
          <h2 className="lq-h2">You’ve submitted</h2>
          <p className="lq-donescore fv-num">
            {answered} of {of} answered
          </p>
          <p className="fv-sub">You can still change an answer until class starts.</p>
          <button type="button" className="fv-btn outline lq-teambtn" onClick={onReview}>
            Review answers
          </button>
        </div>
      </div>
      <footer className="lq-sfoot">
        <button type="button" className="fv-btn outline" onClick={onBack}>
          <Ic name="chevronLeft" size={15} /> Back
        </button>
      </footer>
    </>
  );
}

/**
 * A number (with its unit beside it) or an expression. Saves once what's typed
 * reads as an answer; until then it says why it doesn't.
 */
export function TypedEntry({ q, value, onChange }: { q: LiveQuestion; value: string | null; onChange: (v: string) => void }) {
  const [text, setText] = useState(value ?? "");
  const parsed = q.kind === "number" ? normalizeNumber(text) : canonicalAnswer("expression", text);
  return (
    <div className="lq-numentry">
      <label className="lq-numfield">
        <input
          className="lq-numin"
          // Not "decimal": a phone's number pad has no slash, and 1/2 is an answer.
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={text}
          placeholder={q.kind === "number" ? "Your answer" : "e.g. F/2"}
          aria-label={q.unit ? `Your answer, in ${q.unit}` : "Your answer"}
          onChange={(e) => {
            setText(e.target.value);
            const next = q.kind === "number" ? normalizeNumber(e.target.value) : canonicalAnswer("expression", e.target.value);
            if (next) onChange(next);
          }}
        />
        {q.unit ? <span className="lq-numunit">{q.unit}</span> : null}
      </label>
      {text && !parsed ? <span className="lq-numhint bad">A number or fraction, like 0.5 or 1/2</span> : null}
      {q.kind === "expression" ? <span className="lq-numhint">Any equivalent form counts.</span> : null}
    </div>
  );
}
