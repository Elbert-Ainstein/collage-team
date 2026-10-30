"use client";

// Trying the questions again, after the session has closed — for a student who
// missed it, or wants another go. Each question is shown without its answer;
// Check marks it here, against the key they can already read, and then shows
// the answer and why, the way Review answers does. Nothing is saved: their
// results, their grade and what the instructor sees stay as they were.

import { useEffect, useRef, useState } from "react";
import { optionLetter } from "@/live/answers";
import { Figure } from "@/live/figure";
import type { LiveModel } from "@/live/model";
import { Ic } from "@/live/ui";
import { Explanation } from "./Explanation";
import { TypedEntry } from "./OnYourOwn";
import { practiceRight } from "./practiceCheck";
import { Choices, Typed } from "./ReviewQuestion";

interface Props {
  m: LiveModel;
  /** Back to the results. */
  onDone: () => void;
}

/** What Check came back with, per question id. Null: no key to check against. */
type Verdicts = Record<string, boolean | null>;

function PracticePips({ m, verdicts, current, onPick }: { m: LiveModel; verdicts: Verdicts; current: number; onPick: (q: number) => void }) {
  return (
    <div className="lq-spips">
      {m.questions.map((q, i) => {
        const v = verdicts[q.id];
        const tone = v === true ? " right" : v === false ? " wrong" : "";
        return (
          <button
            key={q.id}
            type="button"
            className={`lq-spip${tone}${i === current ? " now" : ""}`}
            onClick={() => onPick(i)}
            aria-label={`Question ${i + 1}${v === true ? ", right" : v === false ? ", not right" : ""}`}
            aria-current={i === current}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

function verdictText(checked: boolean, verdict: boolean | null | undefined, busy: boolean, failed: boolean): string {
  if (busy) return "Checking…";
  if (failed) return "Couldn’t check that — try again";
  if (!checked) return "";
  if (verdict === null) return "Can’t check this one";
  return verdict ? "Right" : "Not right";
}

export function Practice({ m, onDone }: Props) {
  const N = m.questions.length;
  const [at, setAt] = useState(0);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [verdicts, setVerdicts] = useState<Verdicts>({});
  // Bumped by Try again, so a typed answer's box starts empty.
  const [tries, setTries] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const top = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    top.current?.scrollIntoView?.({ block: "nearest" });
  }, [at]);

  const question = m.questions[at];
  if (!question) return null;
  const pick = picks[question.id] ?? null;
  const checked = question.id in verdicts;
  const verdict = verdicts[question.id];
  const last = at === N - 1;

  const go = (q: number) => {
    setFailed(false);
    setAt(q);
  };
  const choose = (answer: string) => {
    setFailed(false);
    setPicks((p) => ({ ...p, [question.id]: answer }));
  };
  const check = async () => {
    if (pick === null) return;
    setBusy(true);
    setFailed(false);
    try {
      const v = await practiceRight(m, at, pick);
      setVerdicts((prev) => ({ ...prev, [question.id]: v }));
    } catch {
      // The expression checker loads on demand; a dropped connection is the
      // likely cause, and checking again is the way out.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const again = () => {
    const { [question.id]: _pick, ...restPicks } = picks;
    const { [question.id]: _verdict, ...restVerdicts } = verdicts;
    setPicks(restPicks);
    setVerdicts(restVerdicts);
    setTries((t) => ({ ...t, [question.id]: (t[question.id] ?? 0) + 1 }));
  };

  const status = verdictText(checked, verdict, busy, failed);
  return (
    <>
      <div className="lq-sscroll" key={question.id}>
        <div ref={top}>
          <PracticePips m={m} verdicts={verdicts} current={at} onPick={go} />
        </div>
        <div className="fv-eyebrow lq-sq">
          Practice · Question {at + 1} of {N}
        </div>
        <p className="lq-sstem">{question.stem}</p>
        <Figure path={question.figure_path} alt={`Figure for question ${at + 1}`} className="lq-sfig" />
        {checked ? (
          question.kind === "mc" ? (
            <Choices m={m} q={at} mine={pick} />
          ) : (
            <Typed m={m} q={at} mine={pick} right={verdict === true} />
          )
        ) : question.kind === "mc" ? (
          <div className="lq-choices" role="radiogroup" aria-label={`Question ${at + 1}`}>
            {question.options.map((text, i) => {
              const l = optionLetter(i);
              return (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={pick === l}
                  className={`lq-choice${pick === l ? " on" : ""}`}
                  onClick={() => choose(l)}
                >
                  <span className="lq-choicel">{l}</span>
                  <span className="lq-choicet">{text}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <TypedEntry key={`${question.id}:${tries[question.id] ?? 0}`} q={question} value={pick} onChange={choose} />
        )}
        {checked ? <Explanation body={m.explanation(at)} /> : null}
      </div>
      <footer className="lq-sfoot">
        <button type="button" className="fv-btn outline" onClick={at === 0 ? onDone : () => go(at - 1)}>
          <Ic name="chevronLeft" size={15} /> Back
        </button>
        <span className="lq-practicestatus">
          <span className={`lq-saved${failed || verdict === false ? " bad" : verdict === true && !busy ? " good" : ""}`} role="status">
            {status}
          </span>
          {checked ? (
            <button type="button" className="fv-btn ghost sm" onClick={again}>
              Try again
            </button>
          ) : null}
        </span>
        {checked ? (
          <button type="button" className="fv-btn primary" onClick={last ? onDone : () => go(at + 1)}>
            {last ? "Done" : "Next"}
            {last ? null : <Ic name="chevronRight" size={15} />}
          </button>
        ) : (
          <button type="button" className="fv-btn primary" disabled={pick === null || busy} onClick={() => void check()}>
            Check
          </button>
        )}
      </footer>
    </>
  );
}
