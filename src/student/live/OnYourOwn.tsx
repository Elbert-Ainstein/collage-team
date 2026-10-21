"use client";

// Before class: the brief, then each question on its own, then a review list.
// Every answer saves as it's given (useAnswerSaver).

import { useState } from "react";
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
  due,
  answered,
  onStart,
}: {
  m: LiveModel;
  team: TeamWithMembers | null;
  title: string;
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

export function OnYourOwn({
  m,
  saver,
  cursor,
  onCursor,
}: {
  m: LiveModel;
  saver: AnswerSaver;
  cursor: number;
  onCursor: (q: number) => void;
}) {
  const N = m.questions.length;
  const answerOf = (i: number) => saver.answers[m.questions[i]?.id] ?? null;
  const filled = (i: number) => answerOf(i) !== null;

  if (cursor >= N) {
    const done = m.questions.filter((_, i) => filled(i)).length;
    return (
      <div className="lq-sscroll">
        <Pips n={N} current={-1} filled={filled} onPick={onCursor} />
        <div className="lq-scard">
          <h2 className="lq-h2">{done === N ? "All set for class" : `${done} of ${N} answered`}</h2>
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
          {cursor === N - 1 ? "Review" : "Next"} <Ic name="chevronRight" size={15} />
        </button>
      </footer>
    </>
  );
}

/**
 * A number (with its unit beside it) or an expression. Saves once what's typed
 * reads as an answer; until then it says why it doesn't.
 */
function TypedEntry({ q, value, onChange }: { q: LiveQuestion; value: string | null; onChange: (v: string) => void }) {
  const [text, setText] = useState(value ?? "");
  const parsed = q.kind === "number" ? normalizeNumber(text) : canonicalAnswer("expression", text);
  return (
    <div className="lq-numentry">
      <label className="lq-numfield">
        <input
          className="lq-numin"
          inputMode={q.kind === "number" ? "decimal" : "text"}
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
      {text && !parsed ? <span className="lq-numhint bad">Numbers only</span> : null}
      {q.kind === "expression" ? <span className="lq-numhint">Any equivalent form counts.</span> : null}
    </div>
  );
}
